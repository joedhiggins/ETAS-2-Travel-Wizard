import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDays } from "./days.ts";
import { defaultTrip, emptyStop } from "./defaults.ts";
import type { TdyStop } from "./types.ts";

function stop(partial: Partial<TdyStop> & Pick<TdyStop, "city" | "state" | "arrive" | "depart" | "mie" | "lodgingMax" | "lodgingActual">): TdyStop {
  return { ...emptyStop(), ...partial };
}

describe("multi-location lodging", () => {
  it("bills the arrival night and that day's M&IE to the new city", () => {
    const trip = defaultTrip();
    trip.departDate = "2026-03-01";
    trip.returnDate = "2026-03-11";
    trip.hor = "Pascagoula, MS";
    trip.stops = [
      stop({ city: "Houston", state: "TX", arrive: "2026-03-01", depart: "2026-03-05", mie: 80, lodgingMax: 120, lodgingActual: 120 }),
      stop({ city: "Dallas", state: "TX", arrive: "2026-03-05", depart: "2026-03-08", mie: 74, lodgingMax: 150, lodgingActual: 150 }),
      stop({ city: "Oklahoma City", state: "OK", arrive: "2026-03-08", depart: "2026-03-11", mie: 68, lodgingMax: 99, lodgingActual: 99 }),
    ];

    const days = buildDays(trip);
    const byDate = Object.fromEntries(days.map((row) => [row.date, row]));

    assert.equal(byDate["2026-03-01"].location, "Pascagoula, MS");
    assert.equal(byDate["2026-03-01"].lodgingActual, 120);
    assert.equal(byDate["2026-03-01"].mieRate, 80);
    assert.equal(byDate["2026-03-01"].perDiemAdjust, 0.75);

    assert.equal(byDate["2026-03-04"].location, "Houston, TX");
    assert.equal(byDate["2026-03-04"].lodgingActual, 120);
    assert.equal(byDate["2026-03-04"].mieRate, 80);

    assert.equal(byDate["2026-03-05"].location, "Dallas, TX");
    assert.equal(byDate["2026-03-05"].lodgingActual, 150);
    assert.equal(byDate["2026-03-05"].mieRate, 74);
    assert.equal(byDate["2026-03-05"].lodgingMax, 150);

    assert.equal(byDate["2026-03-08"].location, "Oklahoma City, OK");
    assert.equal(byDate["2026-03-08"].lodgingActual, 99);
    assert.equal(byDate["2026-03-08"].mieRate, 68);

    assert.equal(byDate["2026-03-11"].location, "Pascagoula, MS");
    assert.equal(byDate["2026-03-11"].lodgingActual, 0);
    assert.equal(byDate["2026-03-11"].mieRate, 68);
    assert.equal(byDate["2026-03-11"].perDiemAdjust, 0.75);
  });
});
