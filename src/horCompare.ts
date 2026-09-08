import type { OfficialConstructed, TripState } from "./types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function emptyOfficial(): OfficialConstructed {
  return {
    airfare: 0,
    baggage: 0,
    rideshare: 0,
    povMiles: 0,
    airportParking: 0,
    rental: 0,
    rentalFuel: 0,
  };
}

export function needsHorComparison(trip: TripState): boolean {
  const c = trip.compliance;
  return (
    (c.startOtherThanHor === "yes" && c.startOtherReason === "personal") ||
    (c.endOtherThanHor === "yes" && c.endOtherReason === "personal")
  );
}

export function needsConstructedWorksheet(trip: TripState): boolean {
  return trip.compliance.nonstandardMode === "yes" || needsHorComparison(trip);
}

export function actualConstructed(trip: TripState): OfficialConstructed {
  const e = trip.expenses;
  return {
    airfare: e.airfare,
    baggage: round2(e.baggageOutbound + e.baggageReturn),
    rideshare: round2(
      (e.outboundMode === "rideshare" ? e.rideshareOrigin : 0) +
        (e.returnMode === "rideshare" ? e.rideshareReturn : 0),
    ),
    povMiles: round2(
      (e.outboundMode === "pov" ? e.povMilesOrigin : 0) + (e.returnMode === "pov" ? e.povMilesReturn : 0),
    ),
    airportParking: e.outboundMode === "pov" ? e.airportParking : 0,
    rental: e.rental,
    rentalFuel: e.rentalFuel,
  };
}

export function officialConstructedOf(trip: TripState): OfficialConstructed {
  return { ...emptyOfficial(), ...trip.compliance.officialConstructed };
}

export function transportTotal(col: OfficialConstructed, povRate: number): number {
  return round2(
    col.airfare +
      col.baggage +
      col.rideshare +
      col.povMiles * povRate +
      col.airportParking +
      col.rental +
      col.rentalFuel,
  );
}

export function advisoryTransportCap(trip: TripState): {
  official: number;
  actual: number;
  reimbursable: number;
  excess: number;
  officialEntered: boolean;
  actualEntered: boolean;
} {
  const officialCol = officialConstructedOf(trip);
  const actualCol = actualConstructed(trip);
  const official = transportTotal(officialCol, trip.expenses.povRate);
  const actual = transportTotal(actualCol, trip.expenses.povRate);
  return {
    official,
    actual,
    reimbursable: Math.min(actual, official),
    excess: round2(Math.max(0, actual - official)),
    officialEntered: official > 0,
    actualEntered: actual > 0,
  };
}

export function constructedExplanation(trip: TripState): string {
  const c = trip.compliance;
  const hor = trip.hor.trim() || "HOR";
  const bits: string[] = [];
  if (c.startOtherThanHor === "yes" && c.startOtherReason === "personal") {
    bits.push(`Start ${c.startOtherPlace.trim() || "somewhere other than HOR"} instead of ${hor}`);
  }
  if (c.endOtherThanHor === "yes" && c.endOtherReason === "personal") {
    bits.push(`Return to ${c.endOtherPlace.trim() || "somewhere other than HOR"} instead of ${hor}`);
  }
  if (c.nonstandardMode === "yes") {
    bits.push(c.nonstandardNote.trim() || "Non-standard transportation mode");
  }
  if (!bits.length) return "";
  return `${bits.join(". ")}. Standard column is official HOR routing and the authorized mode.`;
}
