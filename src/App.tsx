import { useEffect, useMemo, useRef, useState } from "react";
import {
  actualConstructed,
  advisoryTransportCap,
  constructedExplanation,
  needsConstructedWorksheet,
  needsHorComparison,
  officialConstructedOf,
  transportTotal,
} from "./horCompare.ts";
import { buildDays, formatLongDate, formatMoney, formatOtherBreakout, syncDailyLodging, tripTotals } from "./days";
import { emptyExpense, emptyStop, MAILBOX, POV_RATE_AS_OF } from "./defaults";
import { applyLocality, bundledFiscalYears, lookupByZip, lookupConus, pickBook } from "./rates";
import { composedPurpose, emailLooksValid, generatedPurpose, phoneLooksValid } from "./purpose";
import { requiredDocs } from "./rules";
import type {
  OfficialConstructed,
  ProvenanceSource,
  RateBook,
  RateLibrary,
  RateLocality,
  RateManifest,
  TdyStop,
  TripDocument,
  ZipMap,
} from "./types";
import {
  ConstructedCompareCard,
  CostField,
  ExtraRow,
  GroundLeg,
  Origin,
  OtherThanHorBlock,
  ProvenanceLegend,
  StopEditor,
  YesNoRow,
} from "./fields";
import { Review } from "./Review";
import {
  clearWorkingCopy,
  downloadTripJson,
  emptyDocument,
  loadWorkingCopy,
  markProvenance,
  needsReview,
  parseTripFile,
  saveWorkingCopy,
} from "./tripFile";
import { downloadWorkbook } from "./workbook";

const REVIEW_MODE = new URLSearchParams(window.location.search).get("review") === "1";

const STEPS = ["Trip", "Itinerary", "Mode & exceptions", "Packet"] as const;

export function App() {
  const [step, setStep] = useState(0);
  const [doc, setDoc] = useState<TripDocument>(() => loadWorkingCopy());
  const [library, setLibrary] = useState<RateLibrary>({ books: [], zips: {} });
  const [lookupPicks, setLookupPicks] = useState<Record<string, RateLocality[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const trip = doc.trip;

  useEffect(() => {
    void (async () => {
      try {
        const manifest = (await fetch("./rates/manifest.json").then((r) => r.json())) as RateManifest;
        const books = await Promise.all(
          manifest.fiscalYears.map((fy) => fetch(`./rates/conus-fy${fy}.json`).then((r) => r.json() as Promise<RateBook>)),
        );
        const zips: Record<number, ZipMap> = {};
        await Promise.all(
          manifest.fiscalYears.map(async (fy) => {
            zips[fy] = (await fetch(`./rates/zip-fy${fy}.json`).then((r) => r.json())) as ZipMap;
          }),
        );
        setLibrary({ books, zips });
      } catch {
        setError("Could not load the bundled GSA rate tables. You can still enter rates by hand.");
      }
    })();
  }, []);

  useEffect(() => {
    if (REVIEW_MODE) return;
    saveWorkingCopy(doc);
  }, [doc]);

  const days = useMemo(() => buildDays(trip), [trip]);
  const totals = useMemo(() => tripTotals(days), [days]);
  const docs = useMemo(() => requiredDocs(trip), [trip]);
  const comparison = useMemo(() => {
    const official = officialConstructedOf(trip);
    const actual = actualConstructed(trip);
    const rate = trip.expenses.povRate;
    return {
      official,
      actual,
      officialTotal: transportTotal(official, rate),
      actualTotal: transportTotal(actual, rate),
      cap: advisoryTransportCap(trip),
      explanation: constructedExplanation(trip),
    };
  }, [trip]);

  function patch(partial: Partial<typeof trip>, paths: string[] = []) {
    setDoc((d) => ({
      ...d,
      trip: { ...d.trip, ...partial },
      provenance: paths.length ? markProvenance(d.provenance, paths, "user") : d.provenance,
    }));
  }

  function patchCompliance(partial: Partial<typeof trip.compliance>, paths: string[] = []) {
    patch({ compliance: { ...trip.compliance, ...partial } }, paths);
  }

  function patchOfficial(partial: Partial<OfficialConstructed>) {
    patchCompliance(
      { officialConstructed: { ...trip.compliance.officialConstructed, ...partial } },
      ["compliance.officialConstructed"],
    );
  }

  function patchExpenses(partial: Partial<typeof trip.expenses>, paths: string[] = []) {
    setDoc((d) => ({
      ...d,
      trip: { ...d.trip, expenses: { ...d.trip.expenses, ...partial } },
      provenance: paths.length ? markProvenance(d.provenance, paths, "user") : d.provenance,
    }));
  }

  function applyLookup(stop: TdyStop): TdyStop {
    const date = stop.arrive || trip.departDate;
    const book = pickBook(library.books, date);
    if (!book) return stop;
    const found = stop.zip.trim()
      ? lookupByZip(book, library.zips[book.fiscalYear], stop.zip, date)
      : lookupConus(book, stop.city, stop.state, date);
    setLookupPicks((prev) => ({ ...prev, [stop.id]: found.candidates }));
    if (!found.applied) {
      return { ...stop, rateSource: "standard", rateLabel: found.label };
    }
    const next = {
      ...stop,
      mie: found.mie,
      lodgingMax: found.lodging,
      lodgingActual: found.lodging,
      rateSource: found.source,
      rateLabel: found.label,
    };
    if (found.source === "gsa" && found.candidates[0]) {
      const dest = found.candidates[0];
      if (!next.city.trim()) next.city = dest.destination;
      if (!next.state.trim()) next.state = dest.state;
    }
    return syncDailyLodging(next);
  }

  function applyPickedLocality(stop: TdyStop, loc: RateLocality): TdyStop {
    const date = stop.arrive || trip.departDate;
    const book = pickBook(library.books, date);
    if (!book) return stop;
    const found = applyLocality(book, loc);
    setLookupPicks((prev) => ({ ...prev, [stop.id]: [] }));
    return syncDailyLodging({
      ...stop,
      city: loc.destination,
      state: loc.state,
      mie: found.mie,
      lodgingMax: found.lodging,
      lodgingActual: found.lodging,
      rateSource: found.source,
      rateLabel: found.label,
    });
  }

  async function onImportFile(file: File) {
    setError("");
    setNotice("");
    try {
      const text = await file.text();
      const { doc: incoming, warning } = parseTripFile(text);
      const hasWork =
        trip.travelerName || trip.purpose || trip.departDate || trip.stops.some((s) => s.city);
      if (hasWork && !window.confirm("Replace the current draft with this trip JSON?")) return;
      setDoc(incoming);
      setStep(0);
      const review = needsReview(incoming.provenance)
        ? " Amber fields are LLM values not yet accepted, or unconfirmed. Downloading trip JSON marks untouched LLM fields as accepted."
        : "";
      setNotice((warning ? `${warning} ` : "Imported trip JSON. ") + "Walk the steps to review." + review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that JSON file.");
    }
  }

  async function onExport() {
    setBusy(true);
    setError("");
    try {
      await downloadWorkbook(trip);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workbook export failed");
    } finally {
      setBusy(false);
    }
  }

  if (REVIEW_MODE) return <Review library={library} />;

  return (
    <div className="shell">
      <header className="hero">
        <p className="eyebrow">ETAS · Before you travel</p>
        <h1>Travel authorization packet</h1>
        <p className="lede">
          Local-only draft of the Travel Workbook plus the forms this trip needs.
          Email the pack to <a href={`mailto:${MAILBOX}`}>{MAILBOX}</a>. Do not book until the DPM approves the EA.
        </p>
        <p className="hero-actions">
          <a className="button-link" href={`${window.location.pathname}?review=1`}>Travel team review</a>
        </p>
        <p className="lede import-line">
          <button type="button" className="linkish" onClick={() => importRef.current?.click()}>
            Import trip JSON
          </button>
          {" · "}resume a downloaded draft or drop in a file from the estimate skill.
        </p>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImportFile(file);
          }}
        />
      </header>

      <ol className="steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button type="button" className={i === step ? "active" : i < step ? "done" : ""} onClick={() => setStep(i)}>
              <span>{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {notice && <p className="notice">{notice}</p>}
      {Object.values(doc.provenance).some((source) => source !== "user") && <ProvenanceLegend actor="traveler" />}

      {step === 0 && (
        <section className="card">
          <h2>Who and why</h2>
          <div className="grid">
            <Origin path="travelerName" provenance={doc.provenance}>
              <label>
                Traveler name
                <input value={trip.travelerName} onChange={(e) => patch({ travelerName: e.target.value }, ["travelerName"])} />
              </label>
            </Origin>
            <Origin path="travelerEmail" provenance={doc.provenance}>
              <label>
                Traveler email
                <input
                  type="email"
                  value={trip.travelerEmail}
                  onChange={(e) => patch({ travelerEmail: e.target.value }, ["travelerEmail"])}
                  autoComplete="email"
                />
                {!emailLooksValid(trip.travelerEmail) && <small className="field-warn">Use a full email address (name@domain).</small>}
              </label>
            </Origin>
            <Origin path="travelerPhone" provenance={doc.provenance}>
              <label>
                Traveler phone
                <input
                  type="tel"
                  value={trip.travelerPhone}
                  onChange={(e) => patch({ travelerPhone: e.target.value }, ["travelerPhone"])}
                  autoComplete="tel"
                />
                {!phoneLooksValid(trip.travelerPhone) && <small className="field-warn">Include at least 10 digits.</small>}
              </label>
            </Origin>
            <Origin path="hor" provenance={doc.provenance}>
              <label>
                Home of record
                <input value={trip.hor} onChange={(e) => patch({ hor: e.target.value }, ["hor"])} placeholder="City, ST" />
              </label>
            </Origin>
            <Origin path="project" provenance={doc.provenance}>
              <label>
                Project
                <input value={trip.project} onChange={(e) => patch({ project: e.target.value }, ["project"])} />
              </label>
            </Origin>
            <Origin path="projectCode" provenance={doc.provenance}>
              <label>
                Project code
                <input value={trip.projectCode} onChange={(e) => patch({ projectCode: e.target.value }, ["projectCode"])} />
              </label>
            </Origin>
            <Origin path="departDate" provenance={doc.provenance}>
              <label>
                Depart HOR
                <input type="date" value={trip.departDate} onChange={(e) => patch({ departDate: e.target.value }, ["departDate"])} />
                <small>Trip dates. If you start or end somewhere else, say so on Mode &amp; exceptions.</small>
              </label>
            </Origin>
            <Origin path="returnDate" provenance={doc.provenance}>
              <label>
                Return to HOR
                <input type="date" value={trip.returnDate} onChange={(e) => patch({ returnDate: e.target.value }, ["returnDate"])} />
              </label>
            </Origin>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <h2>TDY locations and per diem</h2>
          <p className="hint">
            First and last calendar days of the trip are 75% M&amp;IE. Arrival night (and that day’s M&amp;IE) belong to
            the new city. GSA CONUS FY{bundledFiscalYears(library).join("–") || "—"} is bundled and picked from the
            stay date (federal FY starts 1 Oct). City/state or ZIP; overwrite any rate.
          </p>
          {trip.stops.map((stop, index) => (
            <StopEditor
              key={stop.id}
              index={index}
              stop={stop}
              departDate={trip.departDate}
              returnDate={trip.returnDate}
              library={library}
              candidates={lookupPicks[stop.id] ?? []}
              provenance={doc.provenance}
              onChange={(next, paths) => {
                setDoc((d) => {
                  const stops = d.trip.stops.slice();
                  stops[index] = next;
                  return {
                    ...d,
                    trip: { ...d.trip, stops },
                    provenance: paths?.length ? markProvenance(d.provenance, paths, "user") : d.provenance,
                  };
                });
              }}
              onLookup={() => {
                const next = applyLookup(stop);
                const source: ProvenanceSource = next.rateSource === "gsa" ? "gsa" : "user";
                setDoc((d) => {
                  const stops = d.trip.stops.slice();
                  stops[index] = next;
                  return {
                    ...d,
                    trip: { ...d.trip, stops },
                    provenance: markProvenance(
                      d.provenance,
                      [`stops.${index}.mie`, `stops.${index}.lodgingMax`, `stops.${index}.lodgingActual`],
                      source,
                    ),
                  };
                });
              }}
              onPick={(loc) => {
                const next = applyPickedLocality(stop, loc);
                setDoc((d) => {
                  const stops = d.trip.stops.slice();
                  stops[index] = next;
                  return {
                    ...d,
                    trip: { ...d.trip, stops },
                    provenance: markProvenance(
                      d.provenance,
                      [`stops.${index}.city`, `stops.${index}.state`, `stops.${index}.mie`, `stops.${index}.lodgingMax`, `stops.${index}.lodgingActual`],
                      "gsa",
                    ),
                  };
                });
              }}
              onRemove={
                trip.stops.length > 1
                  ? () => patch({ stops: trip.stops.filter((s) => s.id !== stop.id) })
                  : undefined
              }
            />
          ))}
          <button type="button" className="secondary" onClick={() => patch({ stops: [...trip.stops, emptyStop()] })}>
            Add another TDY location
          </button>

          <h3>Getting there</h3>
          <GroundLeg
            title="Outbound"
            mode={trip.expenses.outboundMode}
            onMode={(outboundMode) => patchExpenses({ outboundMode })}
            povMiles={trip.expenses.povMilesOrigin}
            onPovMiles={(povMilesOrigin) => {
              const povMilesReturn = trip.expenses.povReturnFollowsOutbound ? povMilesOrigin : trip.expenses.povMilesReturn;
              patchExpenses({ povMilesOrigin, povMilesReturn });
            }}
            rideshare={trip.expenses.rideshareOrigin}
            onRideshare={(rideshareOrigin) => patchExpenses({ rideshareOrigin })}
            showParking
            parking={trip.expenses.airportParking}
            onParking={(airportParking) => patchExpenses({ airportParking })}
            rideshareCompare={trip.expenses.rideshareForParking}
            onRideshareCompare={(rideshareForParking) => patchExpenses({ rideshareForParking })}
            notes={trip.expenses.notes}
            onNotes={(notes) => patchExpenses({ notes })}
            povNoteKey="povOut"
            povMilesHint="Round-trip miles if you are being dropped off"
            rideNoteKey="rideshareOut"
            parkingNoteKey="parking"
          />
          <GroundLeg
            title="Return"
            mode={trip.expenses.returnMode}
            onMode={(returnMode) => patchExpenses({ returnMode })}
            povMiles={trip.expenses.povMilesReturn}
            onPovMiles={(povMilesReturn) => patchExpenses({ povMilesReturn, povReturnFollowsOutbound: false })}
            rideshare={trip.expenses.rideshareReturn}
            onRideshare={(rideshareReturn) => patchExpenses({ rideshareReturn })}
            notes={trip.expenses.notes}
            onNotes={(notes) => patchExpenses({ notes })}
            povNoteKey="povReturn"
            povMilesHint="Round-trip miles if you are being picked up"
            rideNoteKey="rideshareReturn"
            sameMiles={
              trip.expenses.outboundMode === "pov" || trip.expenses.returnMode === "pov"
                ? () => patchExpenses({ povMilesReturn: trip.expenses.povMilesOrigin, povReturnFollowsOutbound: true })
                : undefined
            }
          />
          {(trip.expenses.outboundMode === "pov" || trip.expenses.returnMode === "pov") && (
            <CostField
              label={`POV $ / mile · ${POV_RATE_AS_OF}`}
              value={trip.expenses.povRate}
              onChange={(povRate) => patchExpenses({ povRate })}
              noteKey="povRate"
              notes={trip.expenses.notes}
              onNotes={(notes) => patchExpenses({ notes })}
              step="0.001"
            />
          )}

          <h3>Estimated costs</h3>
          <p className="hint">
            Put the ADTRAV / agent fee <em>inside</em> airfare (the workbook column is “Airfare incl. agent fees”).
            A separate agent-fee field would count twice.
          </p>
          <div className="grid">
            <CostField label="Airfare (include ADTRAV / agent fee here)" value={trip.expenses.airfare} onChange={(airfare) => patchExpenses({ airfare }, ["expenses.airfare"])} noteKey="airfare" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} origin={doc.provenance["expenses.airfare"]} />
            <CostField label="Baggage out" value={trip.expenses.baggageOutbound} onChange={(baggageOutbound) => patchExpenses({ baggageOutbound }, ["expenses.baggageOutbound"])} noteKey="bagOut" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} origin={doc.provenance["expenses.baggageOutbound"]} />
            <CostField label="Baggage return" value={trip.expenses.baggageReturn} onChange={(baggageReturn) => patchExpenses({ baggageReturn }, ["expenses.baggageReturn"])} noteKey="bagReturn" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} origin={doc.provenance["expenses.baggageReturn"]} />
            <CostField label="Rental vehicle" value={trip.expenses.rental} onChange={(rental) => patchExpenses({ rental }, ["expenses.rental"])} noteKey="rental" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} origin={doc.provenance["expenses.rental"]} />
            <CostField label="Rental fuel" value={trip.expenses.rentalFuel} onChange={(rentalFuel) => patchExpenses({ rentalFuel }, ["expenses.rentalFuel"])} noteKey="fuel" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} origin={doc.provenance["expenses.rentalFuel"]} />
          </div>

          <h3>Other expenses (e.g., hotel parking)</h3>
          {trip.expenses.extraExpenses.map((item, i) => (
            <ExtraRow
              key={item.id}
              item={item}
              onChange={(next) => {
                const extraExpenses = trip.expenses.extraExpenses.slice();
                extraExpenses[i] = next;
                patchExpenses({ extraExpenses });
              }}
              onRemove={() => patchExpenses({ extraExpenses: trip.expenses.extraExpenses.filter((x) => x.id !== item.id) })}
            />
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => patchExpenses({ extraExpenses: [...trip.expenses.extraExpenses, emptyExpense(trip.departDate)] })}
          >
            Add expense
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <h2>How you are traveling</h2>
          <p className="hint">C-901 is required on every authorization. The rest of the packet follows these answers.</p>
          <YesNoRow label="Does this trip include air travel?" value={trip.compliance.hasAir} onChange={(hasAir) => patch({ compliance: { ...trip.compliance, hasAir } })} />
          {trip.compliance.hasAir === "yes" && (
            <>
              <YesNoRow label="Is the selected flight the cheapest option that still meets the required timeline?" value={trip.compliance.cheapestMeetsTimeline} onChange={(cheapestMeetsTimeline) => patch({ compliance: { ...trip.compliance, cheapestMeetsTimeline } })} />
              <YesNoRow label="Are you flying economy / coach?" value={trip.compliance.economyClass} onChange={(economyClass) => patch({ compliance: { ...trip.compliance, economyClass } })} />
              <YesNoRow label="Is every flight on a U.S.-flag carrier (or a code-share ticketed on the U.S. designator)?" value={trip.compliance.usFlagCarrier} onChange={(usFlagCarrier) => patch({ compliance: { ...trip.compliance, usFlagCarrier } })} />
            </>
          )}
          <YesNoRow label="Is any part of the trip to or through a foreign country?" value={trip.compliance.foreignCountry} onChange={(foreignCountry) => patch({ compliance: { ...trip.compliance, foreignCountry } })} />
          <YesNoRow label="Will you give a gift or business courtesy to a foreign official?" value={trip.compliance.foreignOfficialGift} onChange={(foreignOfficialGift) => patch({ compliance: { ...trip.compliance, foreignOfficialGift } })} />
          <YesNoRow label="Do you anticipate in-flight internet / Wi-Fi?" value={trip.compliance.inflightWifi} onChange={(inflightWifi) => patch({ compliance: { ...trip.compliance, inflightWifi } })} />
          {trip.compliance.inflightWifi === "yes" && (
            <label className="wide">
              Why, and what information will you access? (goes on C-901)
              <textarea rows={3} value={trip.compliance.inflightWifiNote} onChange={(e) => patch({ compliance: { ...trip.compliance, inflightWifiNote: e.target.value } })} />
            </label>
          )}
          <YesNoRow label="Are you claiming a non-standard FTR mode (for example driving instead of flying) and still want that cost reimbursed?" value={trip.compliance.nonstandardMode} onChange={(nonstandardMode) => patchCompliance({ nonstandardMode })} />
          {trip.compliance.nonstandardMode === "yes" && (
            <label className="wide">
              What is the deviation?
              <input value={trip.compliance.nonstandardNote} onChange={(e) => patchCompliance({ nonstandardNote: e.target.value })} />
            </label>
          )}

          <OtherThanHorBlock
            side="start"
            other={trip.compliance.startOtherThanHor}
            reason={trip.compliance.startOtherReason}
            place={trip.compliance.startOtherPlace}
            onOther={(startOtherThanHor) =>
              patchCompliance({
                startOtherThanHor,
                startOtherReason: startOtherThanHor === "yes" ? trip.compliance.startOtherReason || "personal" : "",
                startOtherPlace: startOtherThanHor === "yes" ? trip.compliance.startOtherPlace : "",
              })
            }
            onReason={(startOtherReason) => patchCompliance({ startOtherReason })}
            onPlace={(startOtherPlace) => patchCompliance({ startOtherPlace })}
          />
          <OtherThanHorBlock
            side="end"
            other={trip.compliance.endOtherThanHor}
            reason={trip.compliance.endOtherReason}
            place={trip.compliance.endOtherPlace}
            onOther={(endOtherThanHor) =>
              patchCompliance({
                endOtherThanHor,
                endOtherReason: endOtherThanHor === "yes" ? trip.compliance.endOtherReason || "personal" : "",
                endOtherPlace: endOtherThanHor === "yes" ? trip.compliance.endOtherPlace : "",
              })
            }
            onReason={(endOtherReason) => patchCompliance({ endOtherReason })}
            onPlace={(endOtherPlace) => patchCompliance({ endOtherPlace })}
          />

          {needsConstructedWorksheet(trip) && (
            <ConstructedCompareCard
              tripHor={trip.hor}
              official={comparison.official}
              actual={comparison.actual}
              povRate={trip.expenses.povRate}
              officialTotal={comparison.officialTotal}
              actualTotal={comparison.actualTotal}
              cap={comparison.cap}
              explanation={comparison.explanation}
              onOfficial={patchOfficial}
              onCopyActual={() => patchOfficial(comparison.actual)}
            />
          )}

          <h3>Purpose of travel</h3>
          <p className="hint">
            The first sentence is filled from project, dates, and TDY cities. Add only what the app cannot know
            (supporting another project, PO-approved SUV, lodging over per diem).
          </p>
          <div className="purpose-preview">{generatedPurpose(trip) || "Add project, dates, and locations on the earlier tabs to fill this sentence."}</div>
          {trip.purposeAddons.map((line, i) => (
            <label key={`addon-${i}`} className="wide">
              Additional justification {i + 1}
              <input
                value={line}
                onChange={(e) => {
                  const purposeAddons = trip.purposeAddons.slice();
                  purposeAddons[i] = e.target.value;
                  patch({ purposeAddons }, ["purposeAddons"]);
                }}
                placeholder="e.g. Supporting MISTIC while funded on this line; authorized lodging $X over per diem because…"
              />
            </label>
          ))}
          <button type="button" className="secondary" onClick={() => patch({ purposeAddons: [...trip.purposeAddons, ""] }, ["purposeAddons"])}>
            Add another line
          </button>
        </section>
      )}

      {step === 3 && (
        <section className="card">
          <h2>Your packet</h2>
          <div className="totals">
            <div>
              <span>Draft total</span>
              <strong>{formatMoney(totals.total)}</strong>
            </div>
            <p>
              {trip.travelerName || "Traveler"}
              {trip.travelerEmail ? ` · ${trip.travelerEmail}` : ""}
              {trip.travelerPhone ? ` · ${trip.travelerPhone}` : ""}
              {" · "}{trip.hor || "HOR"} ·{" "}
              {trip.departDate ? formatLongDate(trip.departDate) : "—"} – {trip.returnDate ? formatLongDate(trip.returnDate) : "—"}
              {" · "}
              {days.length} day rows
              {doc.revision > 0 ? ` · JSON r${doc.revision}` : ""}
              {doc.exportedAt ? ` · last export ${doc.exportedAt}` : ""}
            </p>
            {(trip.compliance.startOtherThanHor === "yes" || trip.compliance.endOtherThanHor === "yes") && (
              <p>
                {trip.compliance.startOtherThanHor === "yes"
                  ? `Starts ${trip.compliance.startOtherPlace || "other than HOR"} (${trip.compliance.startOtherReason || "unspecified"})`
                  : "Starts at HOR"}
                {" · "}
                {trip.compliance.endOtherThanHor === "yes"
                  ? `Ends ${trip.compliance.endOtherPlace || "other than HOR"} (${trip.compliance.endOtherReason || "unspecified"})`
                  : "Returns to HOR"}
              </p>
            )}
          </div>

          {needsConstructedWorksheet(trip) && (
            <div className="advisory">
              <h3>Advisory transportation cap</h3>
              <p className="hint">
                Draft total above is still your actual estimates. This cap is advisory and transportation-only;
                it does not change M&amp;IE, lodging, or the workbook.
              </p>
              {!comparison.cap.officialEntered ? (
                <p className="field-warn">Enter official HOR / authorized-mode costs on Mode &amp; exceptions so the cap can be calculated.</p>
              ) : !comparison.cap.actualEntered ? (
                <p>Official constructed {formatMoney(comparison.cap.official)}. Add itinerary transportation estimates to compare.</p>
              ) : (
                <p>
                  Actual transportation {formatMoney(comparison.cap.actual)} · official constructed {formatMoney(comparison.cap.official)}
                  {" · "}reimbursable (lesser) <strong>{formatMoney(comparison.cap.reimbursable)}</strong>
                  {comparison.cap.excess > 0 ? ` · traveler excess ${formatMoney(comparison.cap.excess)}` : ""}
                </p>
              )}
              {needsHorComparison(trip) && comparison.explanation && <p className="hint">{comparison.explanation}</p>}
            </div>
          )}

          <h3>Purpose of travel</h3>
          <div className="purpose-preview">{composedPurpose(trip) || "—"}</div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Loc</th>
                  <th>Date</th>
                  <th>Place</th>
                  <th>Adj</th>
                  <th>M&amp;IE</th>
                  <th>Lodging</th>
                  <th>Other</th>
                  <th>Other breakout</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {days.map((row) => (
                  <tr key={`${row.locLabel}-${row.date}`}>
                    <td>{row.locLabel}</td>
                    <td>{formatLongDate(row.date)}</td>
                    <td>{row.location}</td>
                    <td>{row.perDiemAdjust.toFixed(2)}</td>
                    <td>{formatMoney(row.mieRate * row.perDiemAdjust)}</td>
                    <td>{formatMoney(row.lodgingActual)}</td>
                    <td>{formatMoney(row.other)}</td>
                    <td>{formatOtherBreakout(row.otherItems)}</td>
                    <td>{row.comments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Required documents</h3>
          <ul className="docs">
            {docs.map((doc) => (
              <li key={doc.id}>
                <div>
                  <strong>{doc.title}</strong>
                  <p>{doc.why}</p>
                  {doc.note && <p className="note">{doc.note}</p>}
                </div>
                {doc.href ? (
                  <a href={doc.href} target="_blank" rel="noreferrer">Open form</a>
                ) : (
                  <span className="muted">Generated / your files</span>
                )}
              </li>
            ))}
          </ul>

          <div className="actions">
            <button type="button" onClick={onExport} disabled={busy || days.length === 0}>
              {busy ? "Building…" : "Download Travel Workbook"}
            </button>
            <button type="button" className="secondary" onClick={() => setDoc(downloadTripJson(doc))}>
              Download trip JSON
            </button>
            <button type="button" className="secondary" onClick={() => importRef.current?.click()}>
              Import trip JSON
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                clearWorkingCopy();
                setDoc(emptyDocument());
                setNotice("");
                setError("");
                setStep(0);
              }}
            >
              Clear draft
            </button>
          </div>
          <p className="hint">
            Next: combine estimates into one PDF, fill the linked forms, and send everything to {MAILBOX}.
            JSON downloads are schema {doc.schemaVersion} with a revision number and UTC timestamp in the filename.
            Trip report / actuals come in a later version.
          </p>
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <nav className="pager">
        <button type="button" className="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
        <button type="button" disabled={step === STEPS.length - 1} onClick={() => setStep((s) => s + 1)}>
          Continue
        </button>
      </nav>
    </div>
  );
}

