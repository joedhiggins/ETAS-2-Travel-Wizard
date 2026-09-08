import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actualConstructed,
  advisoryTransportCap,
  constructedExplanation,
  needsConstructedWorksheet,
  needsHorComparison,
} from "./horCompare.ts";
import { defaultTrip } from "./defaults.ts";
import { requiredDocs } from "./rules.ts";

describe("non-HOR constructed comparison", () => {
  it("does not require a worksheet for an official other-site start", () => {
    const trip = defaultTrip();
    trip.compliance.startOtherThanHor = "yes";
    trip.compliance.startOtherReason = "official";
    trip.compliance.startOtherPlace = "Norfolk, VA";
    assert.equal(needsHorComparison(trip), false);
    assert.equal(needsConstructedWorksheet(trip), false);
    assert.equal(requiredDocs(trip).some((d) => d.id === "constructed"), false);
  });

  it("requires one Task Order worksheet for a personal non-HOR start", () => {
    const trip = defaultTrip();
    trip.compliance.startOtherThanHor = "yes";
    trip.compliance.startOtherReason = "personal";
    trip.compliance.startOtherPlace = "Denver, CO";
    trip.hor = "Pascagoula, MS";
    assert.equal(needsHorComparison(trip), true);
    const doc = requiredDocs(trip).find((d) => d.id === "constructed");
    assert.ok(doc);
    assert.equal(doc?.title, "Task Order Travel Constructed Cost Worksheet");
    assert.match(doc?.why ?? "", /HOR/);
    assert.match(constructedExplanation(trip), /Denver/);
  });

  it("keeps a single worksheet when mode and HOR deviations both apply", () => {
    const trip = defaultTrip();
    trip.compliance.nonstandardMode = "yes";
    trip.compliance.startOtherThanHor = "yes";
    trip.compliance.startOtherReason = "personal";
    const constructed = requiredDocs(trip).filter((d) => d.id === "constructed");
    assert.equal(constructed.length, 1);
    assert.match(constructed[0].why, /mode/);
    assert.match(constructed[0].why, /HOR/);
  });

  it("computes an advisory transportation cap without changing actual totals", () => {
    const trip = defaultTrip();
    trip.expenses.airfare = 800;
    trip.expenses.baggageOutbound = 40;
    trip.expenses.baggageReturn = 40;
    trip.expenses.rideshareOrigin = 50;
    trip.expenses.rideshareReturn = 50;
    trip.compliance.officialConstructed = {
      airfare: 500,
      baggage: 80,
      rideshare: 40,
      povMiles: 0,
      airportParking: 0,
      rental: 0,
      rentalFuel: 0,
    };
    const actual = actualConstructed(trip);
    assert.equal(actual.airfare, 800);
    assert.equal(actual.baggage, 80);
    const cap = advisoryTransportCap(trip);
    assert.equal(cap.actual, 980);
    assert.equal(cap.official, 620);
    assert.equal(cap.reimbursable, 620);
    assert.equal(cap.excess, 360);
    assert.equal(cap.actualEntered, true);
    assert.equal(cap.officialEntered, true);
  });
});