import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  actualConstructed,
  advisoryTransportCap,
  constructedExplanation,
  needsConstructedWorksheet,
  needsHorComparison,
  officialConstructedOf,
  transportTotal,
} from "./horCompare.ts";
import { buildDays, formatLongDate, formatMoney, formatOtherBreakout, parkingReimbursableCap, syncDailyLodging, tripTotals } from "./days";
import { emptyExpense, emptyStop, MAILBOX, POV_RATE_AS_OF, US_STATES } from "./defaults";
import { applyLocality, bundledFiscalYears, lookupByZip, lookupConus, pickBook, stayCrossesFiscalYear, suggestLocalities } from "./rates";
import { composedPurpose, emailLooksValid, generatedPurpose, phoneLooksValid } from "./purpose";
import { requiredDocs } from "./rules";
import type {
  CostNote,
  ExtraExpense,
  GroundMode,
  OfficialConstructed,
  OtherThanHorReason,
  ProvenanceSource,
  RateBook,
  RateLibrary,
  RateLocality,
  RateManifest,
  TdyStop,
  TripDocument,
  YesNo,
  ZipMap,
} from "./types";
import {
  clearWorkingCopy,
  downloadTripJson,
  emptyDocument,
  loadWorkingCopy,
  markProvenance,
  needsReview,
  originClass,
  parseTripFile,
  saveWorkingCopy,
} from "./tripFile";
import { downloadWorkbook } from "./workbook";

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
        ? " Highlighted fields came from an LLM or are unconfirmed — check them before you download the workbook."
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

  return (
    <div className="shell">
      <header className="hero">
        <p className="eyebrow">ETAS · Before you travel</p>
        <h1>Travel authorization packet</h1>
        <p className="lede">
          Local-only draft of the Travel Workbook plus the forms this trip needs.
          Email the pack to <a href={`mailto:${MAILBOX}`}>{MAILBOX}</a>. Do not book until the DPM approves the EA.
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
      {needsReview(doc.provenance) && (
        <p className="hint origin-legend">
          Amber-outlined fields came from an LLM or are unconfirmed. Changing a field marks it as yours.
        </p>
      )}

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

function StopEditor({
  index,
  stop,
  departDate,
  returnDate,
  library,
  candidates,
  provenance,
  onChange,
  onLookup,
  onPick,
  onRemove,
}: {
  index: number;
  stop: TdyStop;
  departDate: string;
  returnDate: string;
  library: RateLibrary;
  candidates: RateLocality[];
  provenance: Record<string, ProvenanceSource>;
  onChange: (stop: TdyStop, paths?: string[]) => void;
  onLookup: () => void;
  onPick: (loc: RateLocality) => void;
  onRemove?: () => void;
}) {
  const book = pickBook(library.books, stop.arrive || departDate);
  const suggestions = book ? suggestLocalities(book, stop.city, stop.state) : [];
  const fyCross = stayCrossesFiscalYear(stop.arrive, stop.depart);
  const showLodgingTable = stop.lodgingMode === "byDay" || stop.taxMode === "byDay";
  const lastDay = stop.depart;
  const p = (field: string) => `stops.${index}.${field}`;
  const [claimLateCheckout, setClaimLateCheckout] = useState(() => (stop.lateCheckoutFee || 0) > 0);

  function setDates(partial: Partial<TdyStop>, paths: string[]) {
    onChange(syncDailyLodging({ ...stop, ...partial }), paths);
  }

  return (
    <fieldset className="stop">
      <legend>Location {index + 2}</legend>
      <div className="grid">
        <Origin path={p("city")} provenance={provenance}>
          <label>
            City
            <input value={stop.city} onChange={(e) => onChange({ ...stop, city: e.target.value }, [p("city")])} list={`loc-${stop.id}`} />
            <datalist id={`loc-${stop.id}`}>
              {suggestions.map((s) => (
                <option key={`${s.destination}-${s.state}`} value={s.destination} />
              ))}
            </datalist>
          </label>
        </Origin>
        <Origin path={p("state")} provenance={provenance}>
          <label>
            State
            <select value={stop.state} onChange={(e) => onChange({ ...stop, state: e.target.value }, [p("state")])}>
              <option value="">—</option>
              {US_STATES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </label>
        </Origin>
        <Origin path={p("zip")} provenance={provenance}>
          <label>
            ZIP (optional)
            <input
              inputMode="numeric"
              value={stop.zip}
              onChange={(e) => onChange({ ...stop, zip: e.target.value.replace(/\D/g, "").slice(0, 5) }, [p("zip")])}
              placeholder="77002"
            />
          </label>
        </Origin>
        <Origin path={p("arrive")} provenance={provenance}>
          <label>
            First day at this TDY
            <input type="date" value={stop.arrive} onChange={(e) => setDates({ arrive: e.target.value }, [p("arrive")])} />
            <button type="button" className="linkish" disabled={!departDate} onClick={() => setDates({ arrive: departDate }, [p("arrive")])}>
              Same as depart HOR
            </button>
          </label>
        </Origin>
        <Origin path={p("depart")} provenance={provenance}>
          <label>
            Last day at this TDY
            <input type="date" value={stop.depart} onChange={(e) => setDates({ depart: e.target.value }, [p("depart")])} />
            <button type="button" className="linkish" disabled={!returnDate} onClick={() => setDates({ depart: returnDate }, [p("depart")])}>
              Same as return HOR
            </button>
          </label>
        </Origin>
        <Origin path={p("mie")} provenance={provenance}>
          <label>
            Daily M&amp;IE
            <input type="number" min={0} step={0.01} value={stop.mie} onChange={(e) => onChange({ ...stop, mie: num(e.target.value), rateSource: "manual", rateLabel: "Traveler override" }, [p("mie")])} />
          </label>
        </Origin>
        <Origin path={p("lodgingMax")} provenance={provenance}>
          <label>
            Max lodging (per diem cap)
            <input type="number" min={0} step={0.01} value={stop.lodgingMax} onChange={(e) => onChange({ ...stop, lodgingMax: num(e.target.value), rateSource: "manual", rateLabel: "Traveler override" }, [p("lodgingMax")])} />
          </label>
        </Origin>
      </div>

      <div className="mode-row">
        <fieldset className="yesno">
          <legend>Actual lodging</legend>
          <label>
            <input type="radio" checked={stop.lodgingMode === "flat"} onChange={() => onChange({ ...stop, lodgingMode: "flat" })} />
            All nights the same
          </label>
          <label>
            <input type="radio" checked={stop.lodgingMode === "byDay"} onChange={() => onChange(syncDailyLodging({ ...stop, lodgingMode: "byDay" }))} />
            By day
          </label>
        </fieldset>
        <fieldset className="yesno">
          <legend>Lodging taxes / fees</legend>
          <label>
            <input type="radio" checked={stop.taxMode === "total"} onChange={() => onChange({ ...stop, taxMode: "total" })} />
            One trip total
          </label>
          <label>
            <input type="radio" checked={stop.taxMode === "byDay"} onChange={() => onChange(syncDailyLodging({ ...stop, taxMode: "byDay" }))} />
            By day
          </label>
        </fieldset>
      </div>

      {stop.lodgingMode === "flat" && (
        <Origin path={p("lodgingActual")} provenance={provenance}>
          <label>
            Actual lodging / night (under the cap is fine)
            <input type="number" min={0} step={0.01} value={stop.lodgingActual || ""} onChange={(e) => onChange({ ...stop, lodgingActual: num(e.target.value) }, [p("lodgingActual")])} />
          </label>
        </Origin>
      )}
      {stop.taxMode === "total" && (
        <label>
          Lodging taxes / fees (total)
          <input type="number" min={0} step={0.01} value={stop.lodgingTaxesTotal || ""} onChange={(e) => onChange({ ...stop, lodgingTaxesTotal: num(e.target.value) })} />
        </label>
      )}

      {showLodgingTable && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                {stop.lodgingMode === "byDay" && <th>Lodging rate</th>}
                {stop.taxMode === "byDay" && <th>Taxes and fees</th>}
              </tr>
            </thead>
            <tbody>
              {stop.dailyLodging.map((row, i) => (
                <tr key={row.date}>
                  <td>Day {i + 1} · {formatLongDate(row.date)}</td>
                  {stop.lodgingMode === "byDay" && (
                    <td>
                      <input type="number" min={0} step={0.01} value={row.lodging || ""} onChange={(e) => {
                        const dailyLodging = stop.dailyLodging.slice();
                        dailyLodging[i] = { ...row, lodging: num(e.target.value) };
                        onChange({ ...stop, dailyLodging });
                      }} />
                    </td>
                  )}
                  {stop.taxMode === "byDay" && (
                    <td>
                      <input type="number" min={0} step={0.01} value={row.taxes || ""} onChange={(e) => {
                        const dailyLodging = stop.dailyLodging.slice();
                        dailyLodging[i] = { ...row, taxes: num(e.target.value) };
                        onChange({ ...stop, dailyLodging });
                      }} />
                    </td>
                  )}
                </tr>
              ))}
              {lastDay && (
                <tr>
                  <td>Last day · {formatLongDate(lastDay)} (checkout)</td>
                  {stop.lodgingMode === "byDay" && <td>$0.00</td>}
                  {stop.taxMode === "byDay" && <td>$0.00</td>}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <label className="note-toggle">
        <input
          type="checkbox"
          checked={claimLateCheckout}
          onChange={(e) => {
            const on = e.target.checked;
            setClaimLateCheckout(on);
            if (!on) onChange({ ...stop, lateCheckoutFee: 0 }, [p("lateCheckoutFee")]);
          }}
        />
        Late checkout fee on last day (optional; more often an expense-report item)
      </label>
      {claimLateCheckout && (
        <label>
          Late checkout fee
          <input
            type="number"
            min={0}
            step={0.01}
            value={stop.lateCheckoutFee || ""}
            onChange={(e) => onChange({ ...stop, lateCheckoutFee: num(e.target.value) }, [p("lateCheckoutFee")])}
          />
        </label>
      )}

      {fyCross && (
        <p className="field-warn">
          This stay crosses 1 Oct (a new GSA fiscal year). Lookup uses the arrival date; enter by-day lodging if rates change mid-stay.
        </p>
      )}
      {candidates.length > 0 && (
        <div className="candidates">
          {candidates.map((loc) => (
            <button key={`${loc.destination}-${loc.state}-${loc.id}`} type="button" className="secondary" onClick={() => onPick(loc)}>
              {loc.destination}, {loc.state}
            </button>
          ))}
        </div>
      )}
      <div className="stop-actions">
        <button type="button" className="secondary" onClick={onLookup} disabled={!book}>
          Look up GSA rate
        </button>
        <small className={stop.rateSource === "manual" ? "override" : ""}>{stop.rateLabel}</small>
        {onRemove && (
          <button type="button" className="linkish" onClick={onRemove}>Remove</button>
        )}
      </div>
    </fieldset>
  );
}

function GroundLeg({
  title,
  mode,
  onMode,
  povMiles,
  onPovMiles,
  rideshare,
  onRideshare,
  showParking,
  parking,
  onParking,
  rideshareCompare,
  onRideshareCompare,
  notes,
  onNotes,
  povNoteKey,
  povMilesHint,
  rideNoteKey,
  parkingNoteKey,
  sameMiles,
}: {
  title: string;
  mode: GroundMode;
  onMode: (mode: GroundMode) => void;
  povMiles: number;
  onPovMiles: (n: number) => void;
  rideshare: number;
  onRideshare: (n: number) => void;
  showParking?: boolean;
  parking?: number;
  onParking?: (n: number) => void;
  rideshareCompare?: number;
  onRideshareCompare?: (n: number) => void;
  notes: Record<string, CostNote>;
  onNotes: (notes: Record<string, CostNote>) => void;
  povNoteKey: string;
  povMilesHint?: string;
  rideNoteKey: string;
  parkingNoteKey?: string;
  sameMiles?: () => void;
}) {
  return (
    <fieldset className="stop">
      <legend>{title}</legend>
      <fieldset className="yesno">
        <legend>How are you getting to / from the airport?</legend>
        <label>
          <input type="radio" checked={mode === "rideshare"} onChange={() => onMode("rideshare")} /> Rideshare / taxi
        </label>
        <label>
          <input type="radio" checked={mode === "pov"} onChange={() => onMode("pov")} /> POV
        </label>
      </fieldset>
      {mode === "pov" ? (
        <div className="grid">
          <label>
            POV miles
            <input type="number" min={0} step={0.1} value={povMiles || ""} onChange={(e) => onPovMiles(num(e.target.value))} />
            {povMilesHint && <small>{povMilesHint}</small>}
            {sameMiles && (
              <button type="button" className="linkish" onClick={sameMiles}>Same as outbound</button>
            )}
          </label>
          <NoteToggle fieldKey={povNoteKey} notes={notes} onNotes={onNotes} />
          {showParking && onParking && (
            <>
              <CostField label="Airport parking" value={parking || 0} onChange={onParking} noteKey={parkingNoteKey || "parking"} notes={notes} onNotes={onNotes} />
              {(parking || 0) > 0 && onRideshareCompare && (
                <div>
                  <CostField
                    label="Round-trip rideshare estimate (out + back, before tip)"
                    value={rideshareCompare || 0}
                    onChange={onRideshareCompare}
                    noteKey="rideshareCompare"
                    notes={notes}
                    onNotes={onNotes}
                  />
                  {rideshareCompare ? (
                    <small>
                      Max reimbursable parking (travel-team 20% tip): {formatMoney(parkingReimbursableCap(rideshareCompare))}
                      {(parking || 0) > parkingReimbursableCap(rideshareCompare)
                        ? " — parking is over that cap; add a note and attach the rideshare quote."
                        : ""}
                    </small>
                  ) : (
                    <small>Enter the rideshare estimate to see the FTR/travel-team parking cap.</small>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <CostField label="Rideshare / taxi" value={rideshare} onChange={onRideshare} noteKey={rideNoteKey} notes={notes} onNotes={onNotes} />
      )}
    </fieldset>
  );
}

function ExtraRow({
  item,
  onChange,
  onRemove,
}: {
  item: ExtraExpense;
  onChange: (item: ExtraExpense) => void;
  onRemove: () => void;
}) {
  return (
    <div className="extra">
      <label>
        Name
        <input value={item.name} onChange={(e) => onChange({ ...item, name: e.target.value })} placeholder="Visa, ITF, resort fee…" />
      </label>
      <label>
        Date
        <input type="date" value={item.date} onChange={(e) => onChange({ ...item, date: e.target.value })} />
      </label>
      <label>
        Amount
        <input type="number" min={0} step={0.01} value={item.amount || ""} onChange={(e) => onChange({ ...item, amount: num(e.target.value) })} />
      </label>
      <label className="note-toggle">
        <input type="checkbox" checked={item.showNote} onChange={(e) => onChange({ ...item, showNote: e.target.checked })} />
        Note
      </label>
      <button type="button" className="linkish" onClick={onRemove}>Remove</button>
      {item.showNote && (
        <label className="wide">
          Note
          <input value={item.note} onChange={(e) => onChange({ ...item, note: e.target.value })} />
        </label>
      )}
    </div>
  );
}

function CostField({
  label,
  value,
  onChange,
  noteKey,
  notes,
  onNotes,
  step = "0.01",
  origin,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  noteKey: string;
  notes: Record<string, CostNote>;
  onNotes: (notes: Record<string, CostNote>) => void;
  step?: string;
  origin?: ProvenanceSource;
}) {
  return (
    <div className={`cost-field ${originClass(origin)}`.trim()}>
      <label>
        {label}
        <input type="number" min={0} step={step} value={value || ""} onChange={(e) => onChange(num(e.target.value))} />
      </label>
      <NoteToggle fieldKey={noteKey} notes={notes} onNotes={onNotes} />
    </div>
  );
}

function NoteToggle({
  fieldKey,
  notes,
  onNotes,
}: {
  fieldKey: string;
  notes: Record<string, CostNote>;
  onNotes: (notes: Record<string, CostNote>) => void;
}) {
  const current = notes[fieldKey] ?? { show: false, text: "" };
  return (
    <div className="note-block">
      <label className="note-toggle">
        <input
          type="checkbox"
          checked={current.show}
          onChange={(e) => onNotes({ ...notes, [fieldKey]: { ...current, show: e.target.checked } })}
        />
        Add note
      </label>
      {current.show && (
        <input
          value={current.text}
          onChange={(e) => onNotes({ ...notes, [fieldKey]: { ...current, text: e.target.value } })}
          placeholder="Variance / receipt note"
        />
      )}
    </div>
  );
}

function OtherThanHorBlock({
  side,
  other,
  reason,
  place,
  onOther,
  onReason,
  onPlace,
}: {
  side: "start" | "end";
  other: YesNo;
  reason: OtherThanHorReason | "";
  place: string;
  onOther: (v: YesNo) => void;
  onReason: (v: OtherThanHorReason) => void;
  onPlace: (v: string) => void;
}) {
  const start = side === "start";
  return (
    <div className="hor-block">
      <YesNoRow
        label={start ? "Does this trip start somewhere other than HOR?" : "Does this trip end somewhere other than HOR?"}
        value={other}
        onChange={onOther}
      />
      {other === "yes" && (
        <>
          <fieldset className="yesno">
            <legend>Why?</legend>
            <label>
              <input type="radio" checked={reason === "personal"} onChange={() => onReason("personal")} />
              Personal / leave — compare against constructed HOR travel
            </label>
            <label>
              <input type="radio" checked={reason === "official"} onChange={() => onReason("official")} />
              Official other site — no HOR comparison
            </label>
          </fieldset>
          <label className="wide">
            {start ? "Actual start city" : "Actual end city"}
            <input value={place} onChange={(e) => onPlace(e.target.value)} placeholder="City, ST" />
          </label>
        </>
      )}
    </div>
  );
}

function ConstructedCompareCard({
  tripHor,
  official,
  actual,
  povRate,
  officialTotal,
  actualTotal,
  cap,
  explanation,
  onOfficial,
  onCopyActual,
}: {
  tripHor: string;
  official: OfficialConstructed;
  actual: OfficialConstructed;
  povRate: number;
  officialTotal: number;
  actualTotal: number;
  cap: ReturnType<typeof advisoryTransportCap>;
  explanation: string;
  onOfficial: (partial: Partial<OfficialConstructed>) => void;
  onCopyActual: () => void;
}) {
  return (
    <fieldset className="stop">
      <legend>Official-route cost comparison</legend>
      <p className="hint">
        Same Task Order Travel Constructed Cost Worksheet as a mode deviation — one form, not a second copy.
        Official column is {tripHor.trim() || "HOR"} ↔ TDY on the authorized mode. Actual column is pulled from
        the estimates on Itinerary. Copy this into the worksheet Explanation: {explanation || "describe the deviation."}
      </p>
      <button type="button" className="secondary" onClick={onCopyActual}>
        Copy actual into official, then edit HOR routing
      </button>
      <div className="table-wrap">
        <table className="compare">
          <thead>
            <tr>
              <th>Transportation</th>
              <th>Official (standard)</th>
              <th>Actual (preferred)</th>
            </tr>
          </thead>
          <tbody>
            <CompareMoneyRow label="Airfare (include ADTRAV / agent fee)" official={official.airfare} actual={actual.airfare} onChange={(airfare) => onOfficial({ airfare })} />
            <CompareMoneyRow label="Baggage" official={official.baggage} actual={actual.baggage} onChange={(baggage) => onOfficial({ baggage })} />
            <CompareMoneyRow label="Taxi / rideshare" official={official.rideshare} actual={actual.rideshare} onChange={(rideshare) => onOfficial({ rideshare })} />
            <tr>
              <td>POV miles × {formatMoney(povRate)}</td>
              <td>
                <input type="number" min={0} step={0.1} value={official.povMiles || ""} onChange={(e) => onOfficial({ povMiles: num(e.target.value) })} />
                <small>{formatMoney(official.povMiles * povRate)}</small>
              </td>
              <td>
                {actual.povMiles || 0} mi
                <small>{formatMoney(actual.povMiles * povRate)}</small>
              </td>
            </tr>
            <CompareMoneyRow label="Airport / departure parking" official={official.airportParking} actual={actual.airportParking} onChange={(airportParking) => onOfficial({ airportParking })} />
            <CompareMoneyRow label="Rental vehicle" official={official.rental} actual={actual.rental} onChange={(rental) => onOfficial({ rental })} />
            <CompareMoneyRow label="Rental fuel" official={official.rentalFuel} actual={actual.rentalFuel} onChange={(rentalFuel) => onOfficial({ rentalFuel })} />
            <tr>
              <td><strong>Transportation total</strong></td>
              <td><strong>{formatMoney(officialTotal)}</strong></td>
              <td><strong>{formatMoney(actualTotal)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="hint">
        {!cap.officialEntered
          ? "Enter the official column to see the advisory cap."
          : !cap.actualEntered
            ? `Official constructed ${formatMoney(cap.official)}. Add itinerary transportation estimates to compare.`
            : `Advisory reimbursable transportation ${formatMoney(cap.reimbursable)}${cap.excess > 0 ? ` · excess ${formatMoney(cap.excess)} is traveler cost` : ""}.`}
      </p>
    </fieldset>
  );
}

function CompareMoneyRow({
  label,
  official,
  actual,
  onChange,
}: {
  label: string;
  official: number;
  actual: number;
  onChange: (n: number) => void;
}) {
  return (
    <tr>
      <td>{label}</td>
      <td>
        <input type="number" min={0} step={0.01} value={official || ""} onChange={(e) => onChange(num(e.target.value))} />
      </td>
      <td>{formatMoney(actual)}</td>
    </tr>
  );
}

function YesNoRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "yes" | "no";
  onChange: (v: "yes" | "no") => void;
}) {
  return (
    <fieldset className="yesno">
      <legend>{label}</legend>
      <label>
        <input type="radio" checked={value === "yes"} onChange={() => onChange("yes")} /> Yes
      </label>
      <label>
        <input type="radio" checked={value === "no"} onChange={() => onChange("no")} /> No
      </label>
    </fieldset>
  );
}

function Origin({
  path,
  provenance,
  className,
  children,
}: {
  path: string;
  provenance: Record<string, ProvenanceSource>;
  className?: string;
  children: ReactNode;
}) {
  const src = provenance[path];
  const origin = originClass(src);
  return (
    <div
      className={[className, origin].filter(Boolean).join(" ") || undefined}
      title={src && src !== "user" ? `Source: ${src}` : undefined}
    >
      {children}
    </div>
  );
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
