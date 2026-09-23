import { useEffect, useMemo, useRef, useState } from "react";
import { buildDays, formatLongDate, formatMoney, formatOtherBreakout, syncDailyLodging, tripTotals } from "./days";
import { emptyExpense, emptyStop, POV_RATE_AS_OF } from "./defaults";
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
import {
  actualConstructed,
  advisoryTransportCap,
  constructedExplanation,
  needsConstructedWorksheet,
  officialConstructedOf,
  transportTotal,
} from "./horCompare.ts";
import { composedPurpose, generatedPurpose } from "./purpose";
import { applyLocality, checkBundledRate, lookupByZip, lookupConus, pickBook, type BundledRateCheck } from "./rates";
import { requiredDocs } from "./rules";
import type { OfficialConstructed, RateLibrary, RateLocality, TdyStop, TripDocument, TripState } from "./types";
import {
  clearReviewCopy,
  downloadTripJson,
  loadReviewCopy,
  markProvenance,
  readTripFile,
  saveReviewCopy,
  shiftStopProvenance,
  tripFieldErrors,
} from "./tripFile";
import { downloadWorkbook } from "./workbook";

export function Review({ library }: { library: RateLibrary }) {
  const [doc, setDoc] = useState<TripDocument | null>(() => loadReviewCopy());
  const [lookupPicks, setLookupPicks] = useState<Record<string, RateLocality[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const trip = doc?.trip;

  useEffect(() => {
    document.title = "ETAS Travel team review";
    return () => {
      document.title = "ETAS Travel Authorization";
    };
  }, []);

  useEffect(() => {
    if (doc) saveReviewCopy(doc);
  }, [doc]);

  const days = useMemo(() => (trip ? buildDays(trip) : []), [trip]);
  const totals = useMemo(() => tripTotals(days), [days]);
  const packetDocs = useMemo(() => (trip ? requiredDocs(trip) : []), [trip]);
  const fieldErrors = useMemo(() => (trip ? tripFieldErrors(trip) : []), [trip]);
  const comparison = useMemo(() => {
    if (!trip) return null;
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

  function patch(partial: Partial<TripState>, paths: string[] = []) {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        trip: { ...d.trip, ...partial },
        provenance: paths.length ? markProvenance(d.provenance, paths, "travel-team") : d.provenance,
      };
    });
  }

  function patchExpenses(partial: Partial<TripState["expenses"]>, paths: string[] = []) {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        trip: { ...d.trip, expenses: { ...d.trip.expenses, ...partial } },
        provenance: paths.length ? markProvenance(d.provenance, paths, "travel-team") : d.provenance,
      };
    });
  }

  function patchCompliance(partial: Partial<TripState["compliance"]>, paths: string[]) {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        trip: { ...d.trip, compliance: { ...d.trip.compliance, ...partial } },
        provenance: markProvenance(d.provenance, paths, "travel-team"),
      };
    });
  }

  function patchOfficial(partial: Partial<OfficialConstructed>) {
    if (!trip) return;
    patchCompliance(
      { officialConstructed: { ...trip.compliance.officialConstructed, ...partial } },
      ["compliance.officialConstructed"],
    );
  }

  function applyLookup(stop: TdyStop): TdyStop {
    if (!trip) return stop;
    const date = stop.arrive || trip.departDate;
    const book = pickBook(library.books, date);
    if (!book) return stop;
    const found = stop.zip.trim()
      ? lookupByZip(book, library.zips[book.fiscalYear], stop.zip, date)
      : lookupConus(book, stop.city, stop.state, date);
    setLookupPicks((prev) => ({ ...prev, [stop.id]: found.candidates }));
    if (!found.applied) return { ...stop, rateSource: "standard", rateLabel: found.label };
    const next: TdyStop = {
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
    if (!trip) return stop;
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
      const parsed = readTripFile(await file.text(), "review");
      const hasWork = Boolean(trip && (trip.travelerName || trip.departDate || trip.stops.some((s) => s.city)));
      if (hasWork && !window.confirm("Replace the open review with this authorization JSON? The traveler draft in this browser stays as it is.")) {
        return;
      }
      setDoc(parsed.doc);
      setLookupPicks({});
      const problem = parsed.errors.length
        ? ` ${parsed.errors.length} field problem${parsed.errors.length === 1 ? "" : "s"} to correct.`
        : "";
      setNotice((parsed.warning ? `${parsed.warning} ` : "Opened authorization JSON.") + problem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that JSON file.");
    }
  }

  async function onWorkbook() {
    if (!trip) return;
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

  function onDownloadJson() {
    if (!doc) return;
    setDoc(downloadTripJson(doc));
    setNotice("Downloaded trip JSON. Untouched LLM fields are now marked LLM accepted.");
  }

  function onClear() {
    if (!window.confirm("Clear this review copy? The traveler draft in this browser stays as it is.")) return;
    clearReviewCopy();
    setDoc(null);
    setLookupPicks({});
    setNotice("");
    setError("");
  }

  const backHref = window.location.pathname;

  return (
    <div className="shell">
      <header className="hero">
        <p className="eyebrow">ETAS · Travel team</p>
        <h1>Review authorization</h1>
        <p className="lede">
          Open a traveler’s authorization JSON, correct it, and download updated JSON or the Travel Workbook.
          This review stays in this browser, separate from a traveler draft.
        </p>
        <p className="hero-actions">
          <a className="button-link secondary" href={backHref}>Traveler wizard</a>
          <button type="button" onClick={() => importRef.current?.click()}>Open authorization JSON</button>
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

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {!doc || !trip || !comparison ? (
        <section className="card">
          <h2>No authorization open</h2>
          <p className="hint">Choose an authorization JSON file. Expense files are not openable yet.</p>
        </section>
      ) : (
        <>
          {Object.values(doc.provenance).some((source) => source !== "user") && <ProvenanceLegend actor="reviewer" />}

          {fieldErrors.length > 0 && (
            <section className="card field-errors" aria-label="Field problems">
              <h2>Correct these before treating the file as ready</h2>
              <ul>
                {fieldErrors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2>Traveler</h2>
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
                  <input value={trip.travelerEmail} onChange={(e) => patch({ travelerEmail: e.target.value }, ["travelerEmail"])} />
                </label>
              </Origin>
              <Origin path="travelerPhone" provenance={doc.provenance}>
                <label>
                  Traveler phone
                  <input value={trip.travelerPhone} onChange={(e) => patch({ travelerPhone: e.target.value }, ["travelerPhone"])} />
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

          <section className="card">
            <h2>Purpose</h2>
            <p className="hint">The first sentence is built from project, dates, and TDY cities. Edit the added lines to correct justification.</p>
            <div className="purpose-preview">{generatedPurpose(trip) || "Add project, dates, and locations to fill this sentence."}</div>
            {trip.purposeAddons.map((line, i) => (
              <Origin key={`addon-${i}`} path="purposeAddons" provenance={doc.provenance}>
                <label className="wide">
                  Additional justification {i + 1}
                  <input
                    value={line}
                    onChange={(e) => {
                      const purposeAddons = trip.purposeAddons.slice();
                      purposeAddons[i] = e.target.value;
                      patch({ purposeAddons }, ["purposeAddons"]);
                    }}
                  />
                </label>
              </Origin>
            ))}
            <button type="button" className="secondary" onClick={() => patch({ purposeAddons: [...trip.purposeAddons, ""] }, ["purposeAddons"])}>
              Add another line
            </button>
            {trip.purpose.trim() && (
              <Origin path="purpose" provenance={doc.provenance}>
                <label className="wide">
                  Older purpose text
                  <textarea rows={3} value={trip.purpose} onChange={(e) => patch({ purpose: e.target.value }, ["purpose"])} />
                </label>
              </Origin>
            )}
            <h3>Purpose on the workbook</h3>
            <div className="purpose-preview">{composedPurpose(trip) || "—"}</div>
          </section>

          <section className="card">
            <h2>Stops</h2>
            <p className="hint">
              Changing a city, ZIP, or date leaves the entered M&amp;IE and lodging cap in place.
              Look up GSA to write the bundled rates. If those rates differ from what is entered, the bundled figures are shown beside them.
            </p>
            {trip.stops.map((stop, index) => (
              <div key={stop.id}>
                <StopEditor
                  index={index}
                  stop={stop}
                  departDate={trip.departDate}
                  returnDate={trip.returnDate}
                  library={library}
                  candidates={lookupPicks[stop.id] ?? []}
                  provenance={doc.provenance}
                  onChange={(next, paths) => {
                    setDoc((d) => {
                      if (!d) return d;
                      const stops = d.trip.stops.slice();
                      stops[index] = next;
                      return {
                        ...d,
                        trip: { ...d.trip, stops },
                        provenance: paths?.length ? markProvenance(d.provenance, paths, "travel-team") : d.provenance,
                      };
                    });
                  }}
                  onLookup={() => {
                    const next = applyLookup(stop);
                    const wroteRates = next.rateSource === "gsa" || next.mie !== stop.mie || next.lodgingMax !== stop.lodgingMax;
                    setDoc((d) => {
                      if (!d) return d;
                      const stops = d.trip.stops.slice();
                      stops[index] = next;
                      return {
                        ...d,
                        trip: { ...d.trip, stops },
                        provenance: wroteRates
                          ? markProvenance(d.provenance, [`stops.${index}.mie`, `stops.${index}.lodgingMax`, `stops.${index}.lodgingActual`], "gsa")
                          : d.provenance,
                      };
                    });
                  }}
                  onPick={(loc) => {
                    const next = applyPickedLocality(stop, loc);
                    setDoc((d) => {
                      if (!d) return d;
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
                      ? () => {
                          setDoc((d) => {
                            if (!d) return d;
                            return {
                              ...d,
                              trip: { ...d.trip, stops: d.trip.stops.filter((s) => s.id !== stop.id) },
                              provenance: shiftStopProvenance(d.provenance, index),
                            };
                          });
                        }
                      : undefined
                  }
                />
                <BundledRateNote library={library} stop={stop} departDate={trip.departDate} />
              </div>
            ))}
            <button type="button" className="secondary" onClick={() => patch({ stops: [...trip.stops, emptyStop()] })}>
              Add another TDY location
            </button>
          </section>

          <section className="card">
            <h2>Costs</h2>
            <GroundLeg
              title="Outbound"
              mode={trip.expenses.outboundMode}
              onMode={(outboundMode) => patchExpenses({ outboundMode }, ["expenses.outboundMode"])}
              povMiles={trip.expenses.povMilesOrigin}
              onPovMiles={(povMilesOrigin) => {
                if (trip.expenses.povReturnFollowsOutbound) {
                  patchExpenses(
                    { povMilesOrigin, povMilesReturn: povMilesOrigin },
                    ["expenses.povMilesOrigin", "expenses.povMilesReturn"],
                  );
                } else {
                  patchExpenses({ povMilesOrigin }, ["expenses.povMilesOrigin"]);
                }
              }}
              rideshare={trip.expenses.rideshareOrigin}
              onRideshare={(rideshareOrigin) => patchExpenses({ rideshareOrigin }, ["expenses.rideshareOrigin"])}
              showParking
              parking={trip.expenses.airportParking}
              onParking={(airportParking) => patchExpenses({ airportParking }, ["expenses.airportParking"])}
              rideshareCompare={trip.expenses.rideshareForParking}
              onRideshareCompare={(rideshareForParking) => patchExpenses({ rideshareForParking }, ["expenses.rideshareForParking"])}
              notes={trip.expenses.notes}
              onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])}
              povNoteKey="povOut"
              rideNoteKey="rideshareOut"
              parkingNoteKey="parking"
              fieldOrigins={{
                mode: doc.provenance["expenses.outboundMode"],
                povMiles: doc.provenance["expenses.povMilesOrigin"],
                rideshare: doc.provenance["expenses.rideshareOrigin"],
                parking: doc.provenance["expenses.airportParking"],
                rideshareCompare: doc.provenance["expenses.rideshareForParking"],
              }}
            />
            <GroundLeg
              title="Return"
              mode={trip.expenses.returnMode}
              onMode={(returnMode) => patchExpenses({ returnMode }, ["expenses.returnMode"])}
              povMiles={trip.expenses.povMilesReturn}
              onPovMiles={(povMilesReturn) => patchExpenses({ povMilesReturn, povReturnFollowsOutbound: false }, ["expenses.povMilesReturn"])}
              rideshare={trip.expenses.rideshareReturn}
              onRideshare={(rideshareReturn) => patchExpenses({ rideshareReturn }, ["expenses.rideshareReturn"])}
              notes={trip.expenses.notes}
              onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])}
              povNoteKey="povReturn"
              rideNoteKey="rideshareReturn"
              sameMiles={
                trip.expenses.outboundMode === "pov" || trip.expenses.returnMode === "pov"
                  ? () => patchExpenses({ povMilesReturn: trip.expenses.povMilesOrigin, povReturnFollowsOutbound: true }, ["expenses.povMilesReturn"])
                  : undefined
              }
              fieldOrigins={{
                mode: doc.provenance["expenses.returnMode"],
                povMiles: doc.provenance["expenses.povMilesReturn"],
                rideshare: doc.provenance["expenses.rideshareReturn"],
              }}
            />
            {(trip.expenses.outboundMode === "pov" || trip.expenses.returnMode === "pov") && (
              <CostField
                label={`POV $ / mile · ${POV_RATE_AS_OF}`}
                value={trip.expenses.povRate}
                onChange={(povRate) => patchExpenses({ povRate }, ["expenses.povRate"])}
                noteKey="povRate"
                notes={trip.expenses.notes}
                onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])}
                step="0.001"
                origin={doc.provenance["expenses.povRate"]}
              />
            )}
            <div className="grid">
              <CostField label="Airfare (include ADTRAV / agent fee here)" value={trip.expenses.airfare} onChange={(airfare) => patchExpenses({ airfare }, ["expenses.airfare"])} noteKey="airfare" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])} origin={doc.provenance["expenses.airfare"]} />
              <CostField label="Baggage out" value={trip.expenses.baggageOutbound} onChange={(baggageOutbound) => patchExpenses({ baggageOutbound }, ["expenses.baggageOutbound"])} noteKey="bagOut" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])} origin={doc.provenance["expenses.baggageOutbound"]} />
              <CostField label="Baggage return" value={trip.expenses.baggageReturn} onChange={(baggageReturn) => patchExpenses({ baggageReturn }, ["expenses.baggageReturn"])} noteKey="bagReturn" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])} origin={doc.provenance["expenses.baggageReturn"]} />
              <CostField label="Rental vehicle" value={trip.expenses.rental} onChange={(rental) => patchExpenses({ rental }, ["expenses.rental"])} noteKey="rental" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])} origin={doc.provenance["expenses.rental"]} />
              <CostField label="Rental fuel" value={trip.expenses.rentalFuel} onChange={(rentalFuel) => patchExpenses({ rentalFuel }, ["expenses.rentalFuel"])} noteKey="fuel" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes }, ["expenses.notes"])} origin={doc.provenance["expenses.rentalFuel"]} />
            </div>
            <h3>Other expenses</h3>
            {trip.expenses.extraExpenses.map((item, i) => (
              <ExtraRow
                key={item.id}
                item={item}
                onChange={(next) => {
                  const extraExpenses = trip.expenses.extraExpenses.slice();
                  extraExpenses[i] = next;
                  patchExpenses({ extraExpenses }, ["expenses.extraExpenses"]);
                }}
                onRemove={() => patchExpenses({ extraExpenses: trip.expenses.extraExpenses.filter((x) => x.id !== item.id) }, ["expenses.extraExpenses"])}
              />
            ))}
            <button type="button" className="secondary" onClick={() => patchExpenses({ extraExpenses: [...trip.expenses.extraExpenses, emptyExpense(trip.departDate)] }, ["expenses.extraExpenses"])}>
              Add expense
            </button>
          </section>

          <section className="card">
            <h2>Compliance</h2>
            <Origin path="compliance.hasAir" provenance={doc.provenance}>
              <YesNoRow label="Does this trip include air travel?" value={trip.compliance.hasAir} onChange={(hasAir) => patchCompliance({ hasAir }, ["compliance.hasAir"])} />
            </Origin>
            {trip.compliance.hasAir === "yes" && (
              <>
                <Origin path="compliance.cheapestMeetsTimeline" provenance={doc.provenance}>
                  <YesNoRow label="Is the selected flight the cheapest option that still meets the required timeline?" value={trip.compliance.cheapestMeetsTimeline} onChange={(cheapestMeetsTimeline) => patchCompliance({ cheapestMeetsTimeline }, ["compliance.cheapestMeetsTimeline"])} />
                </Origin>
                <Origin path="compliance.economyClass" provenance={doc.provenance}>
                  <YesNoRow label="Are you flying economy / coach?" value={trip.compliance.economyClass} onChange={(economyClass) => patchCompliance({ economyClass }, ["compliance.economyClass"])} />
                </Origin>
                <Origin path="compliance.usFlagCarrier" provenance={doc.provenance}>
                  <YesNoRow label="Is every flight on a U.S.-flag carrier (or a code-share ticketed on the U.S. designator)?" value={trip.compliance.usFlagCarrier} onChange={(usFlagCarrier) => patchCompliance({ usFlagCarrier }, ["compliance.usFlagCarrier"])} />
                </Origin>
              </>
            )}
            <Origin path="compliance.foreignCountry" provenance={doc.provenance}>
              <YesNoRow label="Is any part of the trip to or through a foreign country?" value={trip.compliance.foreignCountry} onChange={(foreignCountry) => patchCompliance({ foreignCountry }, ["compliance.foreignCountry"])} />
            </Origin>
            <Origin path="compliance.foreignOfficialGift" provenance={doc.provenance}>
              <YesNoRow label="Will you give a gift or business courtesy to a foreign official?" value={trip.compliance.foreignOfficialGift} onChange={(foreignOfficialGift) => patchCompliance({ foreignOfficialGift }, ["compliance.foreignOfficialGift"])} />
            </Origin>
            <Origin path="compliance.inflightWifi" provenance={doc.provenance}>
              <YesNoRow label="Do you anticipate in-flight internet / Wi-Fi?" value={trip.compliance.inflightWifi} onChange={(inflightWifi) => patchCompliance({ inflightWifi }, ["compliance.inflightWifi"])} />
            </Origin>
            {trip.compliance.inflightWifi === "yes" && (
              <Origin path="compliance.inflightWifiNote" provenance={doc.provenance}>
                <label className="wide">
                  Why, and what information will you access?
                  <textarea rows={3} value={trip.compliance.inflightWifiNote} onChange={(e) => patchCompliance({ inflightWifiNote: e.target.value }, ["compliance.inflightWifiNote"])} />
                </label>
              </Origin>
            )}
            <Origin path="compliance.nonstandardMode" provenance={doc.provenance}>
              <YesNoRow label="Are you claiming a non-standard FTR mode and still want that cost reimbursed?" value={trip.compliance.nonstandardMode} onChange={(nonstandardMode) => patchCompliance({ nonstandardMode }, ["compliance.nonstandardMode"])} />
            </Origin>
            {trip.compliance.nonstandardMode === "yes" && (
              <Origin path="compliance.nonstandardNote" provenance={doc.provenance}>
                <label className="wide">
                  What is the deviation?
                  <input value={trip.compliance.nonstandardNote} onChange={(e) => patchCompliance({ nonstandardNote: e.target.value }, ["compliance.nonstandardNote"])} />
                </label>
              </Origin>
            )}
            <OtherThanHorBlock
              side="start"
              other={trip.compliance.startOtherThanHor}
              reason={trip.compliance.startOtherReason}
              place={trip.compliance.startOtherPlace}
              onOther={(startOtherThanHor) =>
                patchCompliance(
                  {
                    startOtherThanHor,
                    startOtherReason: startOtherThanHor === "yes" ? trip.compliance.startOtherReason || "personal" : "",
                    startOtherPlace: startOtherThanHor === "yes" ? trip.compliance.startOtherPlace : "",
                  },
                  ["compliance.startOtherThanHor"],
                )
              }
              onReason={(startOtherReason) => patchCompliance({ startOtherReason }, ["compliance.startOtherReason"])}
              onPlace={(startOtherPlace) => patchCompliance({ startOtherPlace }, ["compliance.startOtherPlace"])}
            />
            <OtherThanHorBlock
              side="end"
              other={trip.compliance.endOtherThanHor}
              reason={trip.compliance.endOtherReason}
              place={trip.compliance.endOtherPlace}
              onOther={(endOtherThanHor) =>
                patchCompliance(
                  {
                    endOtherThanHor,
                    endOtherReason: endOtherThanHor === "yes" ? trip.compliance.endOtherReason || "personal" : "",
                    endOtherPlace: endOtherThanHor === "yes" ? trip.compliance.endOtherPlace : "",
                  },
                  ["compliance.endOtherThanHor"],
                )
              }
              onReason={(endOtherReason) => patchCompliance({ endOtherReason }, ["compliance.endOtherReason"])}
              onPlace={(endOtherPlace) => patchCompliance({ endOtherPlace }, ["compliance.endOtherPlace"])}
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
          </section>

          <section className="card">
            <h2>Day rows and packet</h2>
            <div className="totals">
              <div>
                <span>Draft total</span>
                <strong>{formatMoney(totals.total)}</strong>
              </div>
              <p>
                {trip.travelerName || "Traveler"}
                {" · "}
                {trip.departDate ? formatLongDate(trip.departDate) : "—"} – {trip.returnDate ? formatLongDate(trip.returnDate) : "—"}
                {" · "}
                {days.length} day rows
                {doc.revision > 0 ? ` · JSON r${doc.revision}` : ""}
              </p>
            </div>
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
              {packetDocs.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.why}</p>
                    {item.note && <p className="note">{item.note}</p>}
                  </div>
                  {item.href ? (
                    <a href={item.href} target="_blank" rel="noreferrer">Open form</a>
                  ) : (
                    <span className="muted">Generated / traveler files</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button type="button" onClick={() => void onWorkbook()} disabled={busy}>
                {busy ? "Building…" : "Download Travel Workbook"}
              </button>
              <button type="button" className="secondary" onClick={onDownloadJson}>
                Download trip JSON
              </button>
              <button type="button" className="secondary" onClick={() => importRef.current?.click()}>
                Open another JSON
              </button>
              <button type="button" className="secondary" onClick={onClear}>
                Clear review
              </button>
            </div>
            <p className="hint">
              JSON download keeps the same trip id, bumps the revision, and stores current values only.
              Fields the team changed are marked travel team. Untouched LLM fields become LLM accepted. Unconfirmed fields stay unconfirmed.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function BundledRateNote({
  library,
  stop,
  departDate,
}: {
  library: RateLibrary;
  stop: TdyStop;
  departDate: string;
}) {
  const check: BundledRateCheck = checkBundledRate(library, stop, departDate);
  if (check.status === "unavailable") return null;
  if (check.status === "match") {
    return (
      <p className="hint rate-note">
        Matches bundled GSA: M&amp;IE {formatMoney(check.mie ?? 0)}, lodging cap {formatMoney(check.lodging ?? 0)}.
      </p>
    );
  }
  if (check.status === "differ") {
    return (
      <p className="field-warn rate-note">
        Bundled GSA is M&amp;IE {formatMoney(check.mie ?? 0)} and lodging cap {formatMoney(check.lodging ?? 0)}.
        Entered M&amp;IE {formatMoney(stop.mie)} and lodging cap {formatMoney(stop.lodgingMax)}. {check.label}
      </p>
    );
  }
  return <p className="hint rate-note">No bundled locality. {check.label}</p>;
}
