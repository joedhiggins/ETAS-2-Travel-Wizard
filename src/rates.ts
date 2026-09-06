import type { RateBook, RateLocality, SeasonMd } from "./types";

function mdToOrdinal(md: SeasonMd): number {
  return md.m * 32 + md.d;
}

function dateToMd(iso: string): SeasonMd {
  const [y, m, d] = iso.split("-").map(Number);
  void y;
  return { m, d };
}

export function seasonContains(dateIso: string, begin: SeasonMd | null, end: SeasonMd | null): boolean {
  if (!begin || !end) return true;
  const x = mdToOrdinal(dateToMd(dateIso));
  const a = mdToOrdinal(begin);
  const b = mdToOrdinal(end);
  if (a <= b) return x >= a && x <= b;
  return x >= a || x <= b;
}

export function lookupConus(book: RateBook, city: string, state: string, dateIso: string): {
  lodging: number;
  mie: number;
  source: "gsa" | "standard";
  label: string;
} {
  const st = state.trim().toUpperCase();
  const needle = city.trim().toLowerCase();
  if (!st || !needle || !dateIso) {
    return {
      lodging: book.standard.lodging,
      mie: book.standard.mie,
      source: "standard",
      label: "Standard CONUS — add city, state, and date to look up",
    };
  }

  const matches = book.localities.filter((loc) => {
    if (loc.state !== st) return false;
    if (!seasonContains(dateIso, loc.seasonBegin, loc.seasonEnd)) return false;
    const dest = loc.destination.toLowerCase();
    return dest === needle || dest.includes(needle) || needle.includes(dest.split("/")[0].trim());
  });

  const exact = matches.find((loc) => loc.destination.toLowerCase() === needle)
    ?? matches.find((loc) => loc.destination.toLowerCase().startsWith(needle))
    ?? matches[0];

  if (!exact) {
    return {
      lodging: book.standard.lodging,
      mie: book.standard.mie,
      source: "standard",
      label: `Standard CONUS $${book.standard.lodging} / $${book.standard.mie} (no NSA match for ${city}, ${st})`,
    };
  }

  return {
    lodging: exact.lodging,
    mie: exact.mie,
    source: "gsa",
    label: `${exact.destination}, ${exact.state} · ${exact.county || "listed locality"} · GSA FY${book.fiscalYear}`,
  };
}

export function suggestLocalities(book: RateBook, city: string, state: string): RateLocality[] {
  const st = state.trim().toUpperCase();
  const needle = city.trim().toLowerCase();
  if (needle.length < 2) return [];
  return book.localities
    .filter((loc) => (!st || loc.state === st) && loc.destination.toLowerCase().includes(needle))
    .filter((loc, i, arr) => arr.findIndex((x) => x.destination === loc.destination && x.state === loc.state) === i)
    .slice(0, 8);
}
