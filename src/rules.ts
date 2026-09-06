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

  if (trip.compliance.nonstandardMode === "yes") {
    docs.push({
      id: "constructed",
      title: "Constructed cost comparison",
      why: "Claiming a mode that is not the standard FTR-reimbursable mode (for example driving instead of flying). Reimbursement is capped at the constructed standard-mode cost.",
      href: "./forms/Constructed-Cost-Comparison.pdf",
    });
  }

  return docs;
}
