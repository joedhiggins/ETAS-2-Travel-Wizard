import type { ExtraExpense, TripState } from "./types";

export const STORAGE_KEY = "etas-tar-beta-v2";
export const MAILBOX = "ETAS_travel@hii.com";
export const DEFAULT_POV_RATE = 0.76;
export const POV_RATE_AS_OF = "FTR Bulletin 26-03, effective 1 Jul 2026";

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyStop(): TripState["stops"][number] {
  return {
    id: newId(),
    city: "",
    state: "",
    arrive: "",
    depart: "",
    mie: 68,
    lodgingMax: 110,
    lodgingMode: "flat",
    taxMode: "total",
    lodgingActual: 110,
    lodgingTaxesTotal: 0,
    lateCheckoutFee: 0,
    dailyLodging: [],
    rateSource: "standard",
    rateLabel: "Standard CONUS (enter or look up)",
  };
}

export function emptyExpense(date = ""): ExtraExpense {
  return { id: newId(), name: "", date, amount: 0, showNote: false, note: "" };
}

export function defaultTrip(): TripState {
  return {
    travelerName: "",
    hor: "",
    project: "",
    projectCode: "",
    purpose: "",
    departDate: "",
    returnDate: "",
    stops: [emptyStop()],
    expenses: {
      airfare: 0,
      baggageOutbound: 0,
      baggageReturn: 0,
      rental: 0,
      rentalFuel: 0,
      outboundMode: "rideshare",
      returnMode: "rideshare",
      povMilesOrigin: 0,
      povMilesReturn: 0,
      povReturnFollowsOutbound: true,
      povRate: DEFAULT_POV_RATE,
      airportParking: 0,
      rideshareOrigin: 0,
      rideshareReturn: 0,
      extraExpenses: [],
      notes: {},
    },
    compliance: {
      hasAir: "yes",
      cheapestMeetsTimeline: "yes",
      economyClass: "yes",
      usFlagCarrier: "yes",
      foreignCountry: "no",
      foreignOfficialGift: "no",
      inflightWifi: "no",
      inflightWifiNote: "",
      nonstandardMode: "no",
      nonstandardNote: "",
    },
  };
}

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
];
