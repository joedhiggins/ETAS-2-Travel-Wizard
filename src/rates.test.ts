import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fiscalYearForDate, lookupConus, lookupByZip, pickBook, stayCrossesFiscalYear } from "./rates.ts";
import type { RateBook, ZipMap } from "./types.ts";

const book: RateBook = {
  source: "test",
  url: "",
  effectiveFrom: "2025-10-01",
  effectiveTo: "2026-09-30",
  fiscalYear: 2026,
  standard: { lodging: 110, mie: 68 },
  localities: [
    { id: "1", state: "TX", destination: "Houston", county: "Harris", seasonBegin: null, seasonEnd: null, lodging: 168, mie: 80 },
    { id: "2", state: "TX", destination: "Dallas", county: "Dallas", seasonBegin: null, seasonEnd: null, lodging: 161, mie: 80 },
  ],
};

describe("fiscal year", () => {
  it("starts on 1 October", () => {
    assert.equal(fiscalYearForDate("2026-09-30"), 2026);
    assert.equal(fiscalYearForDate("2026-10-01"), 2027);
    assert.equal(stayCrossesFiscalYear("2026-09-28", "2026-10-03"), true);
    assert.equal(stayCrossesFiscalYear("2026-03-01", "2026-03-08"), false);
  });

  it("picks the book for the travel date", () => {
    const fy27 = { ...book, fiscalYear: 2027, standard: { lodging: 113, mie: 68 } };
    assert.equal(pickBook([book, fy27], "2026-09-30")?.fiscalYear, 2026);
    assert.equal(pickBook([book, fy27], "2026-10-01")?.fiscalYear, 2027);
  });
});

describe("city lookup", () => {
  it("applies an exact city match", () => {
    const hit = lookupConus(book, "Houston", "TX", "2026-03-05");
    assert.equal(hit.applied, true);
    assert.equal(hit.source, "gsa");
    assert.equal(hit.lodging, 168);
  });

  it("does not silently apply a near-miss", () => {
    const hit = lookupConus(book, "Huston", "TX", "2026-03-05");
    assert.equal(hit.applied, false);
    assert.ok(hit.candidates.some((c) => c.destination === "Houston"));
  });
});

describe("ZIP lookup", () => {
  it("maps a ZIP onto the locality, then standard CONUS if the city is not an NSA", () => {
    const zips: ZipMap = { fiscalYear: 2026, z: { "77002": "Houston|TX", "99999": "Nowhere|TX" } };
    const houston = lookupByZip(book, zips, "77002", "2026-03-05");
    assert.equal(houston.source, "gsa");
    assert.equal(houston.lodging, 168);
    const rural = lookupByZip(book, zips, "99999", "2026-03-05");
    assert.equal(rural.source, "standard");
    assert.equal(rural.lodging, 110);
  });
});
