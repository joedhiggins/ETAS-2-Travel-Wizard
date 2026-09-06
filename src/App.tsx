import { useEffect, useMemo, useState } from "react";
import { buildDays, formatLongDate, formatMoney, formatOtherBreakout, syncDailyLodging, tripTotals } from "./days";
import { defaultTrip, emptyExpense, emptyStop, MAILBOX, POV_RATE_AS_OF, STORAGE_KEY, US_STATES } from "./defaults";
import { lookupConus, suggestLocalities } from "./rates";
import { requiredDocs } from "./rules";
import type { CostNote, ExtraExpense, GroundMode, RateBook, TdyStop, TripState } from "./types";
import { downloadTripJson, downloadWorkbook } from "./workbook";

const STEPS = ["Trip", "Itinerary", "Mode & exceptions", "Packet"] as const;

export function App() {
  const [step, setStep] = useState(0);
  const [trip, setTrip] = useState<TripState>(() => loadTrip());
  const [book, setBook] = useState<RateBook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("./rates/conus-fy2026.json")
      .then((r) => r.json())
      .then(setBook)
      .catch(() => setError("Could not load the bundled GSA FY2026 rate table. You can still enter rates by hand."));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trip));
  }, [trip]);

  const days = useMemo(() => buildDays(trip), [trip]);
  const totals = useMemo(() => tripTotals(days), [days]);
  const docs = useMemo(() => requiredDocs(trip), [trip]);

  function patch(partial: Partial<TripState>) {
    setTrip((t) => ({ ...t, ...partial }));
  }

  function patchExpenses(partial: Partial<TripState["expenses"]>) {
    setTrip((t) => ({ ...t, expenses: { ...t.expenses, ...partial } }));
  }

  function applyLookup(stop: TdyStop): TdyStop {
    if (!book) return stop;
    const date = stop.arrive || trip.departDate;
    const found = lookupConus(book, stop.city, stop.state, date);
    return syncDailyLodging({
      ...stop,
      mie: found.mie,
      lodgingMax: found.lodging,
      lodgingActual: found.lodging,
      rateSource: found.source,
      rateLabel: found.label,
    });
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

      {step === 0 && (
        <section className="card">
          <h2>Who and why</h2>
          <div className="grid">
            <label>
              Traveler name
              <input value={trip.travelerName} onChange={(e) => patch({ travelerName: e.target.value })} />
            </label>
            <label>
              Home of record
              <input value={trip.hor} onChange={(e) => patch({ hor: e.target.value })} placeholder="City, ST" />
            </label>
            <label>
              Project
              <input value={trip.project} onChange={(e) => patch({ project: e.target.value })} />
            </label>
            <label>
              Project code
              <input value={trip.projectCode} onChange={(e) => patch({ projectCode: e.target.value })} />
            </label>
            <label>
              Depart HOR
              <input type="date" value={trip.departDate} onChange={(e) => patch({ departDate: e.target.value })} />
            </label>
            <label>
              Return to HOR
              <input type="date" value={trip.returnDate} onChange={(e) => patch({ returnDate: e.target.value })} />
            </label>
            <label className="wide">
              Purpose of travel
              <textarea
                rows={4}
                value={trip.purpose}
                onChange={(e) => patch({ purpose: e.target.value })}
                placeholder="In support of ETAS task order… include PO-approved upgrades or unusual routing."
              />
            </label>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <h2>TDY locations and per diem</h2>
          <p className="hint">
            First and last calendar days of the trip are 75% M&amp;IE. Last day at a location has $0 lodging (checkout),
            plus an optional late-checkout fee. GSA FY2026 CONUS is bundled; overwrite any rate.
          </p>
          {trip.stops.map((stop, index) => (
            <StopEditor
              key={stop.id}
              index={index}
              stop={stop}
              departDate={trip.departDate}
              returnDate={trip.returnDate}
              book={book}
              onChange={(next) => {
                const stops = trip.stops.slice();
                stops[index] = next;
                patch({ stops });
              }}
              onLookup={() => {
                const stops = trip.stops.slice();
                stops[index] = applyLookup(stop);
                patch({ stops });
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
            notes={trip.expenses.notes}
            onNotes={(notes) => patchExpenses({ notes })}
            povNoteKey="povOut"
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
            <CostField label="Airfare (include ADTRAV / agent fee here)" value={trip.expenses.airfare} onChange={(airfare) => patchExpenses({ airfare })} noteKey="airfare" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} />
            <CostField label="Baggage out" value={trip.expenses.baggageOutbound} onChange={(baggageOutbound) => patchExpenses({ baggageOutbound })} noteKey="bagOut" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} />
            <CostField label="Baggage return" value={trip.expenses.baggageReturn} onChange={(baggageReturn) => patchExpenses({ baggageReturn })} noteKey="bagReturn" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} />
            <CostField label="Rental vehicle" value={trip.expenses.rental} onChange={(rental) => patchExpenses({ rental })} noteKey="rental" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} />
            <CostField label="Rental fuel" value={trip.expenses.rentalFuel} onChange={(rentalFuel) => patchExpenses({ rentalFuel })} noteKey="fuel" notes={trip.expenses.notes} onNotes={(notes) => patchExpenses({ notes })} />
          </div>

          <h3>Other expenses</h3>
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
          <YesNoRow label="Are you claiming a non-standard FTR mode (for example driving instead of flying) and still want that cost reimbursed?" value={trip.compliance.nonstandardMode} onChange={(nonstandardMode) => patch({ compliance: { ...trip.compliance, nonstandardMode } })} />
          {trip.compliance.nonstandardMode === "yes" && (
            <label className="wide">
              What is the deviation?
              <input value={trip.compliance.nonstandardNote} onChange={(e) => patch({ compliance: { ...trip.compliance, nonstandardNote: e.target.value } })} />
            </label>
          )}
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
              {trip.travelerName || "Traveler"} · {trip.hor || "HOR"} ·{" "}
              {trip.departDate ? formatLongDate(trip.departDate) : "—"} – {trip.returnDate ? formatLongDate(trip.returnDate) : "—"}
              {" · "}
              {days.length} day rows
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
            <button type="button" className="secondary" onClick={() => downloadTripJson(trip)}>
              Download trip JSON
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                localStorage.removeItem(STORAGE_KEY);
                setTrip(defaultTrip());
                setStep(0);
              }}
            >
              Clear draft
            </button>
          </div>
          <p className="hint">
            Next: combine estimates into one PDF, fill the linked forms, and send everything to {MAILBOX}.
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
  book,
  onChange,
  onLookup,
  onRemove,
}: {
  index: number;
  stop: TdyStop;
  departDate: string;
  returnDate: string;
  book: RateBook | null;
  onChange: (stop: TdyStop) => void;
  onLookup: () => void;
  onRemove?: () => void;
}) {
  const suggestions = book ? suggestLocalities(book, stop.city, stop.state) : [];
  const showLodgingTable = stop.lodgingMode === "byDay" || stop.taxMode === "byDay";
  const lastDay = stop.depart;

  function setDates(partial: Partial<TdyStop>) {
    onChange(syncDailyLodging({ ...stop, ...partial }));
  }

  return (
    <fieldset className="stop">
      <legend>Location {index + 2}</legend>
      <div className="grid">
        <label>
          City
          <input value={stop.city} onChange={(e) => onChange({ ...stop, city: e.target.value })} list={`loc-${stop.id}`} />
          <datalist id={`loc-${stop.id}`}>
            {suggestions.map((s) => (
              <option key={`${s.destination}-${s.state}`} value={s.destination} />
            ))}
          </datalist>
        </label>
        <label>
          State
          <select value={stop.state} onChange={(e) => onChange({ ...stop, state: e.target.value })}>
            <option value="">—</option>
            {US_STATES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </label>
        <label>
          First day at this TDY
          <input type="date" value={stop.arrive} onChange={(e) => setDates({ arrive: e.target.value })} />
          <button type="button" className="linkish" disabled={!departDate} onClick={() => setDates({ arrive: departDate })}>
            Same as depart HOR
          </button>
        </label>
        <label>
          Last day at this TDY
          <input type="date" value={stop.depart} onChange={(e) => setDates({ depart: e.target.value })} />
          <button type="button" className="linkish" disabled={!returnDate} onClick={() => setDates({ depart: returnDate })}>
            Same as return HOR
          </button>
        </label>
        <label>
          Daily M&amp;IE
          <input type="number" min={0} step={0.01} value={stop.mie} onChange={(e) => onChange({ ...stop, mie: num(e.target.value), rateSource: "manual", rateLabel: "Traveler override" })} />
        </label>
        <label>
          Max lodging (per diem cap)
          <input type="number" min={0} step={0.01} value={stop.lodgingMax} onChange={(e) => onChange({ ...stop, lodgingMax: num(e.target.value), rateSource: "manual", rateLabel: "Traveler override" })} />
        </label>
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
        <label>
          Actual lodging / night (under the cap is fine)
          <input type="number" min={0} step={0.01} value={stop.lodgingActual || ""} onChange={(e) => onChange({ ...stop, lodgingActual: num(e.target.value) })} />
        </label>
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

      <label>
        Late checkout fee (last day at this location)
        <input type="number" min={0} step={0.01} value={stop.lateCheckoutFee || ""} onChange={(e) => onChange({ ...stop, lateCheckoutFee: num(e.target.value) })} />
      </label>

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
  notes,
  onNotes,
  povNoteKey,
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
  notes: Record<string, CostNote>;
  onNotes: (notes: Record<string, CostNote>) => void;
  povNoteKey: string;
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
            {sameMiles && (
              <button type="button" className="linkish" onClick={sameMiles}>Same as outbound</button>
            )}
          </label>
          <NoteToggle fieldKey={povNoteKey} notes={notes} onNotes={onNotes} />
          {showParking && onParking && (
            <CostField label="Airport parking" value={parking || 0} onChange={onParking} noteKey={parkingNoteKey || "parking"} notes={notes} onNotes={onNotes} />
          )}
        </div>
      ) : (
        <CostField label="Rideshare / taxi / parking" value={rideshare} onChange={onRideshare} noteKey={rideNoteKey} notes={notes} onNotes={onNotes} />
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
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  noteKey: string;
  notes: Record<string, CostNote>;
  onNotes: (notes: Record<string, CostNote>) => void;
  step?: string;
}) {
  return (
    <div className="cost-field">
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

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function loadTrip(): TripState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTrip();
    const parsed = JSON.parse(raw) as TripState;
    return {
      ...defaultTrip(),
      ...parsed,
      expenses: { ...defaultTrip().expenses, ...parsed.expenses, notes: parsed.expenses?.notes ?? {} },
      compliance: { ...defaultTrip().compliance, ...parsed.compliance },
      stops: (parsed.stops?.length ? parsed.stops : defaultTrip().stops).map((s) => ({
        ...emptyStop(),
        ...s,
        dailyLodging: s.dailyLodging ?? [],
      })),
    };
  } catch {
    return defaultTrip();
  }
}
