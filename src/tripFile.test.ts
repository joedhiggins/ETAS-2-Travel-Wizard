import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTrip } from "./defaults.ts";
import { emptyDocument, nextExport, readTripFile, serializeTripFile, shiftStopProvenance, tripFieldErrors } from "./tripFile.ts";

function sampleRaw(overrides?: { email?: string; provenance?: Record<string, "user" | "llm" | "llm-accepted" | "gsa" | "travel-team" | "unconfirmed"> }) {
  const trip = defaultTrip();
  trip.travelerName = "Ada Lovelace";
  trip.travelerEmail = overrides?.email ?? "ada@example.com";
  trip.departDate = "2026-03-01";
  trip.returnDate = "2026-03-04";
  trip.stops[0].city = "Houston";
  trip.stops[0].state = "TX";
  trip.stops[0].arrive = "2026-03-01";
  trip.stops[0].depart = "2026-03-04";
  const doc = emptyDocument(trip);
  doc.tripId = "trip-1";
  doc.revision = 2;
  doc.provenance = overrides?.provenance ?? { travelerName: "llm", hor: "unconfirmed", project: "user" };
  return serializeTripFile(doc, "2026-03-01T00:00:00.000Z", 2);
}

describe("JSON download acceptance", () => {
  it("retags untouched llm fields and leaves unconfirmed alone", () => {
    const doc = emptyDocument();
    doc.provenance = {
      travelerName: "llm",
      hor: "unconfirmed",
      project: "user",
      "stops.0.mie": "gsa",
    };
    doc.trip.travelerName = "Ada";
    const next = nextExport(doc, "2026-04-01T12:00:00.000Z");
    assert.equal(next.revision, doc.revision + 1);
    assert.equal(next.trip.travelerName, "Ada");
    assert.equal(next.provenance.travelerName, "llm-accepted");
    assert.equal(next.provenance.hor, "unconfirmed");
    assert.equal(next.provenance.project, "user");
    assert.equal(next.provenance["stops.0.mie"], "gsa");
    assert.equal(next.tripId, doc.tripId);
  });
});

describe("review file open", () => {
  it("opens an authorization with field errors still attached", () => {
    const parsed = readTripFile(sampleRaw({ email: "not-an-email" }), "review");
    assert.equal(parsed.doc.trip.travelerEmail, "not-an-email");
    assert.ok(parsed.errors.some((error) => error.includes("email")));
    assert.equal(parsed.doc.tripId, "trip-1");
  });

  it("keeps llm-accepted provenance", () => {
    const parsed = readTripFile(sampleRaw({ provenance: { travelerName: "llm-accepted" } }), "review");
    assert.equal(parsed.errors.length, 0);
    assert.equal(parsed.doc.provenance.travelerName, "llm-accepted");
  });

  it("refuses an expense file", () => {
    const raw = sampleRaw().replace('"kind": "authorization"', '"kind": "expense"');
    assert.throws(() => readTripFile(raw, "review"), /Expense \/ actuals files are not openable yet/);
    assert.throws(() => readTripFile(raw, "wizard"), /belong in the reviewer \(later\)/);
  });

  it("refuses a newer schema", () => {
    const raw = sampleRaw().replace('"schemaVersion": 3', '"schemaVersion": 99');
    assert.throws(() => readTripFile(raw, "review"), /schema 99/);
  });

  it("refuses a file that is not a trip", () => {
    assert.throws(() => readTripFile('{"hello":"world"}', "review"), /not a trip file/);
  });
});

describe("stop provenance", () => {
  it("drops the removed stop and shifts later indexes", () => {
    const next = shiftStopProvenance(
      { "stops.0.city": "llm", "stops.1.mie": "gsa", "stops.2.city": "user", travelerName: "travel-team" },
      1,
    );
    assert.equal(next["stops.0.city"], "llm");
    assert.equal(next["stops.1.mie"], undefined);
    assert.equal(next["stops.1.city"], "user");
    assert.equal(next.travelerName, "travel-team");
  });
});

describe("field errors", () => {
  it("reports a return date before depart", () => {
    const trip = defaultTrip();
    trip.departDate = "2026-03-08";
    trip.returnDate = "2026-03-01";
    const errors = tripFieldErrors(trip);
    assert.ok(errors.some((error) => error.includes("Return date")));
  });
});
