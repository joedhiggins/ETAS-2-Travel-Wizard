export type YesNo = "yes" | "no";
export type LodgingEntryMode = "flat" | "byDay";
export type TaxEntryMode = "total" | "byDay";
export type GroundMode = "pov" | "rideshare";
export type OtherThanHorReason = "personal" | "official";

export interface DailyLodging {
  date: string;
  lodging: number;
  taxes: number;
}

export interface CostNote {
  show: boolean;
  text: string;
}

export interface ExtraExpense {
  id: string;
  name: string;
  date: string;
  amount: number;
  showNote: boolean;
  note: string;
}

export interface TdyStop {
  id: string;
  city: string;
  state: string;
  zip: string;
  arrive: string;
  depart: string;
  mie: number;
  lodgingMax: number;
  lodgingMode: LodgingEntryMode;
  taxMode: TaxEntryMode;
  lodgingActual: number;
  lodgingTaxesTotal: number;
  lateCheckoutFee: number;
  dailyLodging: DailyLodging[];
  rateSource: "gsa" | "standard" | "manual";
  rateLabel: string;
}

export interface TripExpenses {
  airfare: number;
  baggageOutbound: number;
  baggageReturn: number;
  rental: number;
  rentalFuel: number;
  outboundMode: GroundMode;
  returnMode: GroundMode;
  povMilesOrigin: number;
  povMilesReturn: number;
  povReturnFollowsOutbound: boolean;
  povRate: number;
  airportParking: number;
  rideshareForParking: number;
  rideshareOrigin: number;
  rideshareReturn: number;
  extraExpenses: ExtraExpense[];
  notes: Record<string, CostNote>;
}

export interface OfficialConstructed {
  airfare: number;
  baggage: number;
  rideshare: number;
  povMiles: number;
  airportParking: number;
  rental: number;
  rentalFuel: number;
}

export interface Compliance {
  hasAir: YesNo;
  cheapestMeetsTimeline: YesNo;
  economyClass: YesNo;
  usFlagCarrier: YesNo;
  foreignCountry: YesNo;
  foreignOfficialGift: YesNo;
  inflightWifi: YesNo;
  inflightWifiNote: string;
  nonstandardMode: YesNo;
  nonstandardNote: string;
  startOtherThanHor: YesNo;
  endOtherThanHor: YesNo;
  startOtherReason: OtherThanHorReason | "";
  endOtherReason: OtherThanHorReason | "";
  startOtherPlace: string;
  endOtherPlace: string;
  officialConstructed: OfficialConstructed;
}

export interface TripState {
  travelerName: string;
  travelerEmail: string;
  travelerPhone: string;
  hor: string;
  project: string;
  projectCode: string;
  purpose: string;
  purposeAddons: string[];
  departDate: string;
  returnDate: string;
  stops: TdyStop[];
  expenses: TripExpenses;
  compliance: Compliance;
}

/** Current trip JSON envelope. Bump SCHEMA_VERSION in tripFile.ts when this changes. */
export type ProvenanceSource = "user" | "llm" | "gsa" | "travel-team" | "unconfirmed";
export type TripFileKind = "authorization" | "expense";

export interface TripDocument {
  schemaVersion: number;
  kind: TripFileKind;
  tripId: string;
  revision: number;
  exportedAt?: string;
  provenance: Record<string, ProvenanceSource>;
  trip: TripState;
}

export interface DayRow {
  locLabel: string;
  date: string;
  location: string;
  consecutive: number;
  perDiemAdjust: number;
  mieRate: number;
  lodgingMax: number;
  lodgingActual: number;
  airfare: number;
  baggage: number;
  rental: number;
  rentalFuel: number;
  povMiles: number;
  povRate: number;
  ground: number;
  other: number;
  otherItems: OtherItem[];
  comments: string;
}

export interface OtherItem {
  label: string;
  amount: number;
}

export interface RequiredDoc {
  id: string;
  title: string;
  why: string;
  href?: string;
  note?: string;
}

export interface SeasonMd {
  m: number;
  d: number;
}

export interface RateLocality {
  id: string;
  state: string;
  destination: string;
  county: string;
  seasonBegin: SeasonMd | null;
  seasonEnd: SeasonMd | null;
  lodging: number;
  mie: number;
}

export interface RateBook {
  source: string;
  url: string;
  effectiveFrom: string;
  effectiveTo: string;
  fiscalYear: number;
  standard: { lodging: number; mie: number };
  localities: RateLocality[];
}

export interface RateManifest {
  fiscalYears: number[];
}

export interface RateLibrary {
  books: RateBook[];
  zips: Record<number, ZipMap>;
}

export interface ZipMap {
  fiscalYear: number;
  z: Record<string, string>;
}
