export type YesNo = "yes" | "no";
export type LodgingEntryMode = "flat" | "byDay";
export type TaxEntryMode = "total" | "byDay";
export type GroundMode = "pov" | "rideshare";

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
  rideshareOrigin: number;
  rideshareReturn: number;
  extraExpenses: ExtraExpense[];
  notes: Record<string, CostNote>;
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
}

export interface TripState {
  travelerName: string;
  hor: string;
  project: string;
  projectCode: string;
  purpose: string;
  departDate: string;
  returnDate: string;
  stops: TdyStop[];
  expenses: TripExpenses;
  compliance: Compliance;
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
