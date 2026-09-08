import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTrip, emptyStop } from "./defaults.ts";
import { composedPurpose, generatedPurpose } from "./purpose.ts";

describe("purpose", () => {
  it("builds the autogen sentence from trip fields and keeps add-ons separate", () => {
    const trip = defaultTrip();
    trip.project = "ETAS";
    trip.projectCode = "1234";
    trip.departDate = "2026-03-01";
    trip.returnDate = "2026-03-04";
    trip.stops = [{ ...emptyStop(), city: "Houston", state: "TX" }];
    trip.purposeAddons = ["Supporting MISTIC on this trip"];
    trip.purpose = "";

    const gen = generatedPurpose(trip);
    assert.match(gen, /ETAS/);
    assert.match(gen, /1234/);
    assert.match(gen, /Houston/);
    assert.equal(composedPurpose(trip).includes("• Supporting MISTIC on this trip"), true);
    assert.equal(composedPurpose(trip).startsWith(gen), true);
  });
});
