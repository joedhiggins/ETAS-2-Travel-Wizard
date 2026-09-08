import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultTrip } from "./defaults.ts";
import { requiredDocs } from "./rules.ts";

describe("requiredDocs constructed worksheet", () => {
  it("still requires the worksheet for a mode-only deviation", () => {
    const trip = defaultTrip();
    trip.compliance.nonstandardMode = "yes";
    const doc = requiredDocs(trip).find((d) => d.id === "constructed");
    assert.equal(doc?.href, "./forms/Constructed-Cost-Comparison.pdf");
  });
});