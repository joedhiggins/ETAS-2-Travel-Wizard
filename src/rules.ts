import { needsConstructedWorksheet, needsHorComparison } from "./horCompare.ts";
import type { RequiredDoc, TripState } from "./types";

export function requiredDocs(trip: TripState): RequiredDoc[] {
  const docs: RequiredDoc[] = [
    {
      id: "tw",
      title: "Travel Workbook (this app generates it)",
      why: "TAR always includes the TW with estimated entitlements and expenses.",
    },
    {
      id: "estimates",
      title: "Travel estimates as a single PDF",
      why: "ADTRAV air/hotel/car estimates, maps for POV, parking, rideshare, and misc. Combine into one PDF if you can.",
    },
    {
      id: "c901",
      title: "Form C-901 Export Questionnaire",
      why: "Required for every ETAS travel authorization (HII employee).",
      href: "./forms/C-901-Export-Questionnaire.pdf",
    },
  ];

  if (trip.compliance.foreignCountry === "yes") {
    docs.push({
      id: "c909",
      title: "Form C-909 (international / export package)",
      why: "C-901 Q1: travel to or through a foreign country. Submit to Security, then ICO, at least 10 business days before departure.",
      note: "Blank C-909 is not in this packet. Get it from the travel team or ICO.",
    });
  }

  if (trip.compliance.foreignOfficialGift === "yes") {
    docs.push({
      id: "c591",
      title: "Form C-591",
      why: "C-901 Q2: gift or business courtesy to a foreign official. Law Department approval, copy to ICO at least 3 business days out.",
      note: "Blank C-591 is not in this packet.",
    });
  }

  if (trip.compliance.hasAir === "yes" && trip.compliance.cheapestMeetsTimeline === "no") {
    docs.push({
      id: "c820",
      title: "Form C-820 Airfare Waiver",
      why: "Selected flight is not the cheapest option that still meets the timeline.",
      href: "./forms/C-820-Airfare-Waiver.pdf",
    });
  }

  if (trip.compliance.hasAir === "yes" && trip.compliance.economyClass === "no") {
    docs.push({
      id: "premium",
      title: "Other-than-economy checklist",
      why: "Not flying economy/coach.",
      href: "./forms/Other-Than-Economy-Checklist.pdf",
      note: "Also attach a screenshot of the coach option from your travel estimate.",
    });
  }

  if (trip.compliance.hasAir === "yes" && trip.compliance.usFlagCarrier === "no") {
    docs.push({
      id: "flyamerica",
      title: "Fly America Act exception",
      why: "A segment uses a non–U.S.-flag carrier (ticket must show the U.S. designator on a code-share).",
      href: "./forms/Fly-America-Exception.pdf",
      note: "Attach the itinerary and the search results from the time of booking.",
    });
  }

  if (trip.expenses.outboundMode === "pov" && trip.expenses.airportParking > 0) {
    docs.push({
      id: "parking-rideshare",
      title: "Rideshare quote for airport parking",
      why: "Airport parking is compared to a round-trip rideshare estimate (plus the travel-team 20% tip). Attach a screenshot of that estimate when parking is claimed.",
    });
  }

  if (needsConstructedWorksheet(trip)) {
    const mode = trip.compliance.nonstandardMode === "yes";
    const hor = needsHorComparison(trip);
    const why = [
      mode ? "Claiming a mode that is not the standard FTR-reimbursable mode (for example driving instead of flying)." : "",
      hor ? "Start or end is somewhere other than HOR for personal / leave reasons. Standard column is constructed HOR ↔ TDY." : "",
      "Transportation reimbursement is capped at the official constructed (standard) column. Attach one worksheet, not two copies.",
    ]
      .filter(Boolean)
      .join(" ");
    docs.push({
      id: "constructed",
      title: "Task Order Travel Constructed Cost Worksheet",
      why,
      href: "./forms/Constructed-Cost-Comparison.pdf",
      note: "Standard = official HOR routing and authorized mode. Preferred = what you actually plan. Put the deviation in Explanation.",
    });
  }

  return docs;
}
