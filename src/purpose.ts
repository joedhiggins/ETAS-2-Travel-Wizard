import { eachDate, formatLongDate } from "./days.ts";
import type { TripState } from "./types";

function formatStop(city: string, state: string): string {
  const c = city.trim();
  const s = state.trim();
  if (c && s) return `${c}, ${s}`;
  return c || s;
}

export function generatedPurpose(trip: TripState): string {
  const places = trip.stops.map((s) => formatStop(s.city, s.state)).filter(Boolean);
  const unique = places.filter((p, i) => places.indexOf(p) === i);
  const n = eachDate(trip.departDate, trip.returnDate).length;
  const project = trip.project.trim();
  const code = trip.projectCode.trim();
  if (!project && !code && !unique.length && !n) return "";

  const under = [project || null, code ? `project code ${code}` : null].filter(Boolean).join(", ");
  const dest = unique.length ? ` to ${unique.join("; ")}` : "";
  const span =
    trip.departDate && trip.returnDate
      ? ` from ${formatLongDate(trip.departDate)} to ${formatLongDate(trip.returnDate)}`
      : "";
  const days = n ? ` for ${n} day${n === 1 ? "" : "s"}` : "";
  const lead = under ? `Traveling under ${under}` : "Travel";
  return `${lead}${dest}${days}${span}.`;
}

export function composedPurpose(trip: TripState): string {
  const head = generatedPurpose(trip);
  const extras = trip.purposeAddons.map((line) => line.trim()).filter(Boolean);
  const bullets = extras.map((line) => (line.startsWith("•") ? line : `• ${line}`));
  const legacy = extras.length ? "" : trip.purpose.trim();
  return [head, ...bullets, legacy].filter(Boolean).join("\n");
}

export function emailLooksValid(value: string): boolean {
  if (!value.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function phoneLooksValid(value: string): boolean {
  if (!value.trim()) return true;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}
