import { useState, type ReactNode } from "react";
import { advisoryTransportCap } from "./horCompare.ts";
import { formatLongDate, formatMoney, parkingReimbursableCap, syncDailyLodging } from "./days";
import { US_STATES } from "./defaults";
import { pickBook, stayCrossesFiscalYear, suggestLocalities } from "./rates";
import { originClass, provenanceCaption } from "./tripFile";
import type {
  CostNote,
  ExtraExpense,
  GroundMode,
  OfficialConstructed,
  OtherThanHorReason,
  ProvenanceSource,
  RateLibrary,
  RateLocality,
  TdyStop,
  YesNo,
} from "./types";

export function StopEditor({
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
            <input type="number" min={0} step={0.01} value={stop.mie} onChange={(e) => onChange({ ...stop, mie: num(e.target.value), rateSource: "manual", rateLabel: "Manual override" }, [p("mie")])} />
          </label>
        </Origin>
        <Origin path={p("lodgingMax")} provenance={provenance}>
          <label>
            Max lodging (per diem cap)
            <input type="number" min={0} step={0.01} value={stop.lodgingMax} onChange={(e) => onChange({ ...stop, lodgingMax: num(e.target.value), rateSource: "manual", rateLabel: "Manual override" }, [p("lodgingMax")])} />
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

export function GroundLeg({
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
  fieldOrigins,
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
  fieldOrigins?: Partial<Record<"mode" | "povMiles" | "rideshare" | "parking" | "rideshareCompare", ProvenanceSource>>;
}) {
  return (
    <fieldset className="stop">
      <legend>{title}</legend>
      <div className={originClass(fieldOrigins?.mode) || undefined}>
        <fieldset className="yesno">
          <legend>How are you getting to / from the airport?</legend>
          <label>
            <input type="radio" checked={mode === "rideshare"} onChange={() => onMode("rideshare")} /> Rideshare / taxi
          </label>
          <label>
            <input type="radio" checked={mode === "pov"} onChange={() => onMode("pov")} /> POV
          </label>
        </fieldset>
        <ProvenanceNote source={fieldOrigins?.mode} />
      </div>
      {mode === "pov" ? (
        <div className="grid">
          <div className={originClass(fieldOrigins?.povMiles) || undefined}>
          <label>
            POV miles
            <input type="number" min={0} step={0.1} value={povMiles || ""} onChange={(e) => onPovMiles(num(e.target.value))} />
            {povMilesHint && <small>{povMilesHint}</small>}
            <ProvenanceNote source={fieldOrigins?.povMiles} />
            {sameMiles && (
              <button type="button" className="linkish" onClick={sameMiles}>Same as outbound</button>
            )}
          </label>
          </div>
          <NoteToggle fieldKey={povNoteKey} notes={notes} onNotes={onNotes} />
          {showParking && onParking && (
            <>
              <CostField label="Airport parking" value={parking || 0} onChange={onParking} noteKey={parkingNoteKey || "parking"} notes={notes} onNotes={onNotes} origin={fieldOrigins?.parking} />
              {(parking || 0) > 0 && onRideshareCompare && (
                <div>
                  <CostField
                    label="Round-trip rideshare estimate (out + back, before tip)"
                    value={rideshareCompare || 0}
                    onChange={onRideshareCompare}
                    noteKey="rideshareCompare"
                    notes={notes}
                    onNotes={onNotes}
                    origin={fieldOrigins?.rideshareCompare}
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
        <CostField label="Rideshare / taxi" value={rideshare} onChange={onRideshare} noteKey={rideNoteKey} notes={notes} onNotes={onNotes} origin={fieldOrigins?.rideshare} />
      )}
    </fieldset>
  );
}

export function ExtraRow({
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

export function CostField({
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
      <ProvenanceNote source={origin} />
    </div>
  );
}

export function NoteToggle({
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

export function OtherThanHorBlock({
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

export function ConstructedCompareCard({
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

export function CompareMoneyRow({
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

export function YesNoRow({
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

export function Origin({
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
      title={src && src !== "user" ? provenanceCaption(src) : undefined}
    >
      {children}
      <ProvenanceNote source={src} />
    </div>
  );
}

export function ProvenanceLegend({ actor }: { actor: "traveler" | "reviewer" }) {
  const close = actor === "reviewer"
    ? "Changing a field here marks it as a travel-team correction."
    : "Changing a field here marks it as yours. Downloading trip JSON marks untouched LLM fields as accepted.";
  return (
    <p className="hint origin-legend">
      Amber is an LLM value not yet accepted, or a field still unconfirmed. Grey is an LLM value left unchanged on a JSON download.
      Green is a GSA lookup. Navy is a travel-team correction. A field with no outline was entered by the traveler. {close}
    </p>
  );
}

function ProvenanceNote({ source }: { source?: ProvenanceSource }) {
  const text = provenanceCaption(source);
  if (!text) return null;
  return <small className="origin-caption">{text}</small>;
}

export function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
