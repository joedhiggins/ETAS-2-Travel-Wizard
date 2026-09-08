import type { DailyLodging, DayRow, OtherItem, TdyStop, TripState } from "./types";

export function eachDate(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${startIso}T12:00:00`);
  const end = new Date(`${endIso}T12:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime()) || cur > end) return out;
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function lodgingNightDates(arrive: string, depart: string): string[] {
  if (!arrive || !depart || arrive >= depart) return [];
  return eachDate(arrive, dayBefore(depart));
}

export function syncDailyLodging(stop: TdyStop): TdyStop {
  const nights = lodgingNightDates(stop.arrive, stop.depart);
  const prev = new Map(stop.dailyLodging.map((row) => [row.date, row]));
  const dailyLodging: DailyLodging[] = nights.map((date) => {
    const existing = prev.get(date);
    return {
      date,
      lodging: existing?.lodging ?? stop.lodgingActual,
      taxes: existing?.taxes ?? 0,
    };
  });
  return { ...stop, dailyLodging };
}

function stopOnDate(stops: TdyStop[], date: string): { stop: TdyStop; index: number } | null {
  let arriving: { stop: TdyStop; index: number } | null = null;
  let covering: { stop: TdyStop; index: number } | null = null;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    if (!stop.arrive || !stop.depart || date < stop.arrive || date > stop.depart) continue;
    const hit = { stop, index: i };
    if (date === stop.arrive) arriving = hit;
    else if (!covering) covering = hit;
  }
  return arriving ?? covering;
}

export function departingStop(stops: TdyStop[], date: string): TdyStop | null {
  return stops.find((stop) => stop.depart === date) ?? null;
}

export const RIDESHARE_TIP_FACTOR = 1.2;

export function parkingReimbursableCap(rideshareRoundTrip: number): number {
  return round2(rideshareRoundTrip * RIDESHARE_TIP_FACTOR);
}

function firstNight(stop: TdyStop): string | null {
  const nights = lodgingNightDates(stop.arrive, stop.depart);
  return nights[0] ?? null;
}

export function lodgingOnDate(stop: TdyStop, date: string): { lodging: number; taxes: number; lateCheckout: number; lastDay: boolean } {
  const lastDay = Boolean(stop.depart && date === stop.depart);
  if (lastDay) {
    return { lodging: 0, taxes: 0, lateCheckout: stop.lateCheckoutFee || 0, lastDay: true };
  }

  let lodging = stop.lodgingActual;
  let taxes = 0;
  if (stop.lodgingMode === "byDay") {
    lodging = stop.dailyLodging.find((row) => row.date === date)?.lodging ?? stop.lodgingActual;
  }
  if (stop.taxMode === "byDay") {
    taxes = stop.dailyLodging.find((row) => row.date === date)?.taxes ?? 0;
  } else if (firstNight(stop) === date) {
    taxes = stop.lodgingTaxesTotal || 0;
  }
  return { lodging, taxes, lateCheckout: 0, lastDay: false };
}

function formatLocation(city: string, state: string): string {
  const c = city.trim();
  const s = state.trim();
  if (c && s) return `${c}, ${s}`;
  return c || s || "";
}

function noteText(trip: TripState, key: string): string {
  const n = trip.expenses.notes[key];
  return n?.show && n.text.trim() ? n.text.trim() : "";
}

export function buildDays(trip: TripState): DayRow[] {
  const dates = eachDate(trip.departDate, trip.returnDate);
  if (!dates.length) return [];

  const firstStop = trip.stops[0];
  const lastStop = trip.stops[trip.stops.length - 1] ?? firstStop;
  const consecutive: Record<string, number> = {};
  const e = trip.expenses;

  return dates.map((date, idx) => {
    const isOrigin = idx === 0;
    const isReturn = idx === dates.length - 1;
    const hit = stopOnDate(trip.stops, date);
    const comments: string[] = [];

    let locLabel = "";
    let location = "";
    let mieRate = 0;
    let lodgingMax = 0;
    let lodgingActual = 0;
    let stopKey = "";
    const otherItems: OtherItem[] = [];

    if (isOrigin) {
      locLabel = "Origin";
      location = trip.hor.trim() || "HOR";
      mieRate = firstStop?.mie || 0;
      stopKey = "origin";
    } else if (isReturn) {
      locLabel = "Return";
      location = trip.hor.trim() || "HOR";
      mieRate = lastStop?.mie || 0;
      stopKey = "return";
    } else if (hit) {
      locLabel = String(hit.index + 2);
      location = formatLocation(hit.stop.city, hit.stop.state);
      mieRate = hit.stop.mie;
      stopKey = hit.stop.id;
    } else {
      locLabel = "—";
      location = "";
      mieRate = firstStop?.mie || 0;
      stopKey = "gap";
    }

    if (hit) {
      lodgingMax = hit.stop.lodgingMax;
      const stay = lodgingOnDate(hit.stop, date);
      lodgingActual = stay.lodging;
      if (stay.taxes) otherItems.push({ label: "Lodging taxes/fees", amount: stay.taxes });
      if (stay.lateCheckout) otherItems.push({ label: "Late checkout", amount: stay.lateCheckout });
    }
    const leaving = departingStop(trip.stops, date);
    if (leaving && leaving.id !== hit?.stop.id && leaving.lateCheckoutFee) {
      otherItems.push({ label: "Late checkout", amount: leaving.lateCheckoutFee });
    }

    consecutive[stopKey] = (consecutive[stopKey] || 0) + 1;

    let ground = 0;
    let povMiles = 0;
    if (isOrigin) {
      if (e.outboundMode === "pov") {
        povMiles = e.povMilesOrigin;
        ground = e.airportParking;
        if (e.airportParking) comments.push("Airport parking");
        if (e.airportParking && e.rideshareForParking) {
          const cap = parkingReimbursableCap(e.rideshareForParking);
          comments.push(
            e.airportParking > cap
              ? `Parking exceeds travel-team rideshare×${RIDESHARE_TIP_FACTOR} cap ${cap.toFixed(2)}`
              : `Parking at or under rideshare×${RIDESHARE_TIP_FACTOR} cap ${cap.toFixed(2)}`,
          );
        }
        const n = noteText(trip, "povOut");
        if (n) comments.push(n);
        const p = noteText(trip, "parking");
        if (p) comments.push(p);
      } else {
        ground = e.rideshareOrigin;
        const n = noteText(trip, "rideshareOut");
        comments.push(n || "Rideshare / ground outbound");
      }
    }
    if (isReturn) {
      if (e.returnMode === "pov") {
        povMiles = e.povMilesReturn;
        const n = noteText(trip, "povReturn");
        if (n) comments.push(n);
      } else {
        ground = e.rideshareReturn;
        const n = noteText(trip, "rideshareReturn");
        comments.push(n || "Rideshare / ground return");
      }
    }

    for (const extra of e.extraExpenses) {
      if (extra.date === date && extra.amount) {
        otherItems.push({ label: extra.name.trim() || "Expense", amount: extra.amount });
        if (extra.showNote && extra.note.trim()) comments.push(extra.note.trim());
      }
    }

    const airNote = noteText(trip, "airfare");
    if (isOrigin && e.airfare && airNote) comments.push(airNote);
    if (isOrigin && e.rental) {
      const n = noteText(trip, "rental");
      if (n) comments.push(n);
    }

    return {
      locLabel,
      date,
      location,
      consecutive: consecutive[stopKey],
      perDiemAdjust: isOrigin || isReturn ? 0.75 : 1,
      mieRate,
      lodgingMax,
      lodgingActual,
      airfare: isOrigin ? e.airfare : 0,
      baggage: isOrigin ? e.baggageOutbound : isReturn ? e.baggageReturn : 0,
      rental: isOrigin ? e.rental : 0,
      rentalFuel: isOrigin ? e.rentalFuel : 0,
      povMiles,
      povRate: e.povRate,
      ground,
      other: round2(otherItems.reduce((sum, item) => sum + item.amount, 0)),
      otherItems,
      comments: comments.filter(Boolean).join(" | "),
    };
  });
}

export function rowTotals(row: DayRow) {
  const mie = round2(row.mieRate * row.perDiemAdjust);
  const pov = round2(row.povMiles * row.povRate);
  const lodging = round2(row.lodgingActual);
  const total = round2(
    mie + lodging + row.airfare + row.baggage + row.rental + row.rentalFuel + pov + row.ground + row.other,
  );
  return { mie, pov, lodging, total };
}

export function tripTotals(rows: DayRow[]) {
  return rows.reduce(
    (acc, row) => {
      const t = rowTotals(row);
      acc.mie += t.mie;
      acc.lodging += t.lodging;
      acc.airfare += row.airfare;
      acc.baggage += row.baggage;
      acc.rental += row.rental;
      acc.fuel += row.rentalFuel;
      acc.pov += t.pov;
      acc.ground += row.ground;
      acc.other += row.other;
      acc.total += t.total;
      return acc;
    },
    { mie: 0, lodging: 0, airfare: 0, baggage: 0, rental: 0, fuel: 0, pov: 0, ground: 0, other: 0, total: 0 },
  );
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatOtherBreakout(items: OtherItem[]): string {
  return items
    .filter((item) => item.amount)
    .map((item) => `${item.label} $${item.amount.toFixed(2)}`)
    .join(" + ");
}

export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatLongDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}
