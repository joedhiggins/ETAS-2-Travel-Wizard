import type { RateBook, RateLibrary, RateLocality, SeasonMd, ZipMap } from "./types";

export interface RateHit {
  lodging: number;
  mie: number;
  source: "gsa" | "standard";
  label: string;
  fiscalYear: number;
  applied: boolean;
  candidates: RateLocality[];
}

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

/** Federal FY: 1 Oct of calendar year Y starts FY Y+1. */
export function fiscalYearForDate(iso: string): number | null {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m) return null;
  return m >= 10 ? y + 1 : y;
}

export function pickBook(books: RateBook[], dateIso: string): RateBook | null {
  if (!books.length) return null;
  const fy = fiscalYearForDate(dateIso);
  if (fy) {
    const hit = books.find((b) => b.fiscalYear === fy);
    if (hit) return hit;
  }
  return books.slice().sort((a, b) => b.fiscalYear - a.fiscalYear)[0] ?? null;
}

export function stayCrossesFiscalYear(arrive: string, depart: string): boolean {
  const a = fiscalYearForDate(arrive);
  const b = fiscalYearForDate(depart);
  return Boolean(a && b && a !== b);
}

export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const n = t.length;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      row[j] = s[i - 1] === t[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[n];
}

function localityScore(needle: string, dest: string): number {
  const d = dest.toLowerCase();
  if (d === needle) return 1;
  if (d.startsWith(needle) || needle.startsWith(d.split("/")[0].trim())) return 0.94;
  if (d.includes(needle) || needle.includes(d.split("/")[0].trim())) return 0.86;
  const dist = levenshtein(needle, d);
  const maxLen = Math.max(needle.length, d.length);
  if (maxLen && dist <= 2) return Math.max(0, 0.9 - dist * 0.08);
  const first = d.split(/[/,]/)[0].trim();
  const tokenDist = levenshtein(needle, first);
  if (first && tokenDist <= 2) return Math.max(0, 0.88 - tokenDist * 0.08);
  return 0;
}

function uniqueLocalities(rows: RateLocality[]): RateLocality[] {
  return rows.filter((loc, i, arr) => arr.findIndex((x) => x.destination === loc.destination && x.state === loc.state) === i);
}

function inSeason(book: RateBook, dateIso: string): RateLocality[] {
  return book.localities.filter((loc) => seasonContains(dateIso, loc.seasonBegin, loc.seasonEnd));
}

function standardHit(book: RateBook, label: string, candidates: RateLocality[] = []): RateHit {
  return {
    lodging: book.standard.lodging,
    mie: book.standard.mie,
    source: "standard",
    label,
    fiscalYear: book.fiscalYear,
    applied: true,
    candidates,
  };
}

function gsaHit(book: RateBook, loc: RateLocality, candidates: RateLocality[]): RateHit {
  return {
    lodging: loc.lodging,
    mie: loc.mie,
    source: "gsa",
    label: `${loc.destination}, ${loc.state} · ${loc.county || "listed locality"} · GSA FY${book.fiscalYear}`,
    fiscalYear: book.fiscalYear,
    applied: true,
    candidates,
  };
}

export function lookupConus(book: RateBook, city: string, state: string, dateIso: string): RateHit {
  const st = state.trim().toUpperCase();
  const needle = city.trim().toLowerCase();
  if (!st || !needle || !dateIso) {
    return standardHit(book, "Standard CONUS — add city, state, and date to look up");
  }

  const seasonal = inSeason(book, dateIso).filter((loc) => loc.state === st);
  const ranked = seasonal
    .map((loc) => ({ loc, score: localityScore(needle, loc.destination) }))
    .filter((row) => row.score >= 0.7)
    .sort((a, b) => b.score - a.score || a.loc.destination.localeCompare(b.loc.destination));

  const candidates = uniqueLocalities(ranked.map((row) => row.loc)).slice(0, 8);
  const best = ranked[0];
  const second = ranked[1];
  const confident =
    best &&
    (best.score >= 0.99 || (best.score >= 0.92 && (!second || second.score < 0.85 || second.loc.destination === best.loc.destination)));

  if (confident && best) {
    return gsaHit(book, best.loc, candidates);
  }

  if (!candidates.length) {
    return standardHit(
      book,
      `Standard CONUS $${book.standard.lodging} / $${book.standard.mie} (no NSA match for ${city}, ${st} · FY${book.fiscalYear})`,
    );
  }

  return {
    lodging: book.standard.lodging,
    mie: book.standard.mie,
    source: "standard",
    label: `Pick a locality — ${candidates.length} near-matches for ${city}, ${st} (FY${book.fiscalYear}). Not applied automatically.`,
    fiscalYear: book.fiscalYear,
    applied: false,
    candidates,
  };
}

export function lookupByZip(book: RateBook, zipMap: ZipMap | undefined, zip: string, dateIso: string): RateHit {
  const digits = zip.replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(digits) || !dateIso) {
    return standardHit(book, "Standard CONUS — add a 5-digit ZIP and date to look up");
  }
  const raw = zipMap?.z[digits];
  if (!raw) {
    return standardHit(book, `ZIP ${digits} is not in the GSA FY${book.fiscalYear} map — try city/state`);
  }
  const [city, state] = raw.split("|");
  const hit = lookupConus(book, city, state, dateIso);
  if (hit.source === "standard" && hit.applied) {
    return {
      ...hit,
      label: `Standard CONUS $${book.standard.lodging} / $${book.standard.mie} · ZIP ${digits} (${city}, ${state}) · FY${book.fiscalYear}`,
    };
  }
  return {
    ...hit,
    label: hit.applied ? `${hit.label} · ZIP ${digits}` : hit.label,
  };
}

export function suggestLocalities(book: RateBook, city: string, state: string): RateLocality[] {
  const st = state.trim().toUpperCase();
  const needle = city.trim().toLowerCase();
  if (needle.length < 2) return [];
  return uniqueLocalities(
    book.localities
      .filter((loc) => !st || loc.state === st)
      .map((loc) => ({ loc, score: localityScore(needle, loc.destination) }))
      .filter((row) => row.score >= 0.7)
      .sort((a, b) => b.score - a.score)
      .map((row) => row.loc),
  ).slice(0, 8);
}

export function applyLocality(book: RateBook, loc: RateLocality): RateHit {
  return gsaHit(book, loc, [loc]);
}

export function bundledFiscalYears(library: RateLibrary): number[] {
  return library.books.map((b) => b.fiscalYear).sort((a, b) => a - b);
}

