import { defaultTrip, emptyOfficialConstructed, emptyStop, newId } from "./defaults";
import type { ProvenanceSource, TripDocument, TripFileKind, TripState } from "./types";

/**
 * Schema changelog
 * 1 — Envelope: schemaVersion, kind, tripId, revision, exportedAt, provenance, trip.
 *     Bare TripState files (pre-envelope exports) migrate to 1 on import.
 * 2 — travelerEmail, travelerPhone, purposeAddons, stop.zip, expenses.rideshareForParking.
 * 3 — Non-HOR start/end detection and official constructed transportation column.
 */
export const SCHEMA_VERSION = 3;
export const STORAGE_KEY = "etas-tar-doc-v1";
export const LEGACY_STORAGE_KEY = "etas-tar-beta-v2";

const PROVENANCE: ProvenanceSource[] = ["user", "llm", "gsa", "travel-team", "unconfirmed"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const REVIEW_SOURCES: ProvenanceSource[] = ["llm", "unconfirmed"];

export function emptyDocument(trip: TripState = defaultTrip()): TripDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "authorization",
    tripId: newId(),
    revision: 0,
    provenance: {},
    trip,
  };
}

export function originClass(source: ProvenanceSource | undefined): string {
  if (source === "llm" || source === "unconfirmed") return "origin-review";
  if (source === "gsa") return "origin-gsa";
  if (source === "travel-team") return "origin-team";
  return "";
}

export function needsReview(provenance: Record<string, ProvenanceSource>): boolean {
  return Object.values(provenance).some((s) => REVIEW_SOURCES.includes(s));
}

export function markProvenance(
  provenance: Record<string, ProvenanceSource>,
  paths: string[],
  source: ProvenanceSource,
): Record<string, ProvenanceSource> {
  const next = { ...provenance };
  for (const path of paths) next[path] = source;
  return next;
}

export function parseTripFile(raw: string): { doc: TripDocument; warning?: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Trip JSON must be an object.");
  }
  const obj = data as Record<string, unknown>;

  if (obj.kind === "expense") {
    throw new Error("This wizard opens authorization JSON only. Expense / actuals files belong in the reviewer (later).");
  }

  if (typeof obj.schemaVersion === "number") {
    if (obj.schemaVersion > SCHEMA_VERSION) {
      throw new Error(`This file uses schema ${obj.schemaVersion}; this app understands up to ${SCHEMA_VERSION}.`);
    }
    if (obj.schemaVersion < 1) {
      throw new Error(`Unsupported schema version ${obj.schemaVersion}.`);
    }
    const trip = hydrateTrip(obj.trip);
    const errors = validateTrip(trip);
    if (errors.length) throw new Error(errors.join(" "));
    return {
      doc: {
        schemaVersion: SCHEMA_VERSION,
        kind: asKind(obj.kind),
        tripId: typeof obj.tripId === "string" && obj.tripId ? obj.tripId : newId(),
        revision: asNonNegInt(obj.revision),
        exportedAt: typeof obj.exportedAt === "string" ? obj.exportedAt : undefined,
        provenance: asProvenance(obj.provenance),
        trip,
      },
    };
  }

  if (!looksLikeTrip(obj)) {
    throw new Error("This JSON is not a trip file (missing trip data and schemaVersion).");
  }
  const trip = hydrateTrip(obj);
  const errors = validateTrip(trip);
  if (errors.length) throw new Error(errors.join(" "));
  return {
    doc: emptyDocument(trip),
    warning: "Imported a legacy trip file (no schema envelope). Saved going forward as schema 3.",
  };
}

export function serializeTripFile(doc: TripDocument, exportedAt: string, revision: number): string {
  const file: TripDocument = {
    schemaVersion: SCHEMA_VERSION,
    kind: "authorization",
    tripId: doc.tripId,
    revision,
    exportedAt,
    provenance: doc.provenance,
    trip: doc.trip,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function tripJsonFilename(trip: TripState, exportedAt: string, revision: number): string {
  const stamp = compactStamp(exportedAt);
  const name = safe(trip.travelerName) || "draft";
  return `ETAS_trip_${name}_r${revision}_${stamp}.json`;
}

export function downloadTripJson(doc: TripDocument): TripDocument {
  const exportedAt = new Date().toISOString();
  const revision = doc.revision + 1;
  const blob = new Blob([serializeTripFile(doc, exportedAt, revision)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = tripJsonFilename(doc.trip, exportedAt, revision);
  a.click();
  URL.revokeObjectURL(a.href);
  return { ...doc, exportedAt, revision };
}

export function compactStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function loadWorkingCopy(): TripDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { doc } = parseTripFile(raw);
      return doc;
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const { doc } = parseTripFile(legacy);
      return doc;
    }
  } catch {
    /* fall through */
  }
  return emptyDocument();
}

export function saveWorkingCopy(doc: TripDocument): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      schemaVersion: doc.schemaVersion,
      kind: doc.kind,
      tripId: doc.tripId,
      revision: doc.revision,
      provenance: doc.provenance,
      trip: doc.trip,
    }),
  );
}

export function clearWorkingCopy(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function looksLikeTrip(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj.stops) || typeof obj.travelerName === "string" || typeof obj.expenses === "object";
}

function asKind(value: unknown): TripFileKind {
  return value === "expense" ? "expense" : "authorization";
}

function asNonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function asProvenance(value: unknown): Record<string, ProvenanceSource> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, ProvenanceSource> = {};
  for (const [key, src] of Object.entries(value as Record<string, unknown>)) {
    if (typeof src === "string" && PROVENANCE.includes(src as ProvenanceSource)) {
      out[key] = src as ProvenanceSource;
    }
  }
  return out;
}

function hydrateTrip(value: unknown): TripState {
  const parsed = (value && typeof value === "object" ? value : {}) as Partial<TripState>;
  const base = defaultTrip();
  return {
    ...base,
    ...parsed,
    expenses: { ...base.expenses, ...parsed.expenses, notes: parsed.expenses?.notes ?? {} },
    compliance: {
      ...base.compliance,
      ...parsed.compliance,
      officialConstructed: {
        ...emptyOfficialConstructed(),
        ...parsed.compliance?.officialConstructed,
      },
    },
    purposeAddons: parsed.purposeAddons?.length ? parsed.purposeAddons : purposeAddonsFromLegacy(parsed),
    stops: (parsed.stops?.length ? parsed.stops : base.stops).map((s) => ({
      ...emptyStop(),
      ...s,
      zip: s.zip ?? "",
      dailyLodging: s.dailyLodging ?? [],
    })),
  };
}

function purposeAddonsFromLegacy(parsed: Partial<TripState>): string[] {
  if (parsed.purposeAddons?.length) return parsed.purposeAddons;
  return [""];
}

function validateTrip(trip: TripState): string[] {
  const errors: string[] = [];
  if (!Array.isArray(trip.stops) || trip.stops.length < 1) {
    errors.push("Trip needs at least one TDY stop.");
  }
  if (trip.departDate && !ISO_DATE.test(trip.departDate)) errors.push("Depart date is not YYYY-MM-DD.");
  if (trip.returnDate && !ISO_DATE.test(trip.returnDate)) errors.push("Return date is not YYYY-MM-DD.");
  if (trip.departDate && trip.returnDate && trip.returnDate < trip.departDate) {
    errors.push("Return date is before depart date.");
  }
  if (trip.travelerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trip.travelerEmail.trim())) {
    errors.push("Traveler email does not look like an email address.");
  }
  if (trip.travelerPhone) {
    const digits = trip.travelerPhone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) errors.push("Traveler phone should include 10–15 digits.");
  }
  trip.stops.forEach((stop, i) => {
    const n = i + 1;
    if (stop.arrive && !ISO_DATE.test(stop.arrive)) errors.push(`Stop ${n} arrive date is not YYYY-MM-DD.`);
    if (stop.depart && !ISO_DATE.test(stop.depart)) errors.push(`Stop ${n} depart date is not YYYY-MM-DD.`);
    if (stop.arrive && stop.depart && stop.depart < stop.arrive) {
      errors.push(`Stop ${n} leaves before it arrives.`);
    }
    if (!Number.isFinite(stop.mie) || stop.mie < 0) errors.push(`Stop ${n} has an invalid M&IE rate.`);
    if (!Number.isFinite(stop.lodgingMax) || stop.lodgingMax < 0) errors.push(`Stop ${n} has an invalid lodging cap.`);
  });
  return errors;
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
}
