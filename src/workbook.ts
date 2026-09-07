import ExcelJS from "exceljs";
import { buildDays, formatLongDate, formatOtherBreakout, rowTotals, tripTotals } from "./days";
import type { TripState } from "./types";

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pwTitle(trip: TripState): string {
  const name = trip.travelerName.trim() || "Traveler";
  const project = trip.project.trim() || "Project";
  return `${name} - ${project}`;
}

function sheetTitle(title: string): string {
  return title.replace(/[:\\/?*[\]]/g, "").slice(0, 31) || "Program WorkBook";
}

export async function downloadWorkbook(trip: TripState): Promise<void> {
  const rows = buildDays(trip);
  const totals = tripTotals(rows);
  const title = pwTitle(trip);
  const wb = new ExcelJS.Workbook();
  wb.creator = "ETAS Travel Wizard";
  wb.title = title;
  const ws = wb.addWorksheet(sheetTitle(title), {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  const orange: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4B183" } };
  const grey: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  const headerFill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7F7F7F" } };
  const thin: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF7F7F7F" } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  ws.mergeCells("A1:A1");
  ws.getCell("A1").value = "Total:";
  ws.getCell("C1").value = title;
  ws.getCell("C1").font = { bold: true, size: 14 };
  ws.getCell("B1").value = money(totals.total);
  ws.getCell("B1").numFmt = '"$"#,##0.00';
  ws.getCell("F1").value = "SubTotals:";
  const sub = [
    ["G1", totals.mie],
    ["I1", totals.lodging],
    ["J1", totals.airfare],
    ["K1", totals.baggage],
    ["L1", totals.rental],
    ["M1", totals.fuel],
    ["O1", totals.pov],
    ["P1", totals.ground],
    ["Q1", totals.other],
  ] as const;
  for (const [addr, val] of sub) {
    ws.getCell(addr).value = money(val);
    ws.getCell(addr).numFmt = '"$"#,##0.00';
  }

  ws.mergeCells("A2:B2");
  ws.getCell("A2").value = "Name";
  ws.getCell("C2").value = trip.travelerName;
  ws.getCell("C2").fill = orange;
  ws.getCell("D2").value = "Project";
  ws.getCell("E2").value = trip.project;
  ws.getCell("E2").fill = orange;
  ws.getCell("F2").value = "Project Code";
  ws.mergeCells("G2:H2");
  ws.getCell("G2").value = trip.projectCode;
  ws.getCell("G2").fill = orange;
  ws.mergeCells("I2:J2");
  ws.getCell("I2").value = "Purpose of Travel";
  ws.mergeCells("K2:N2");
  ws.getCell("K2").value = trip.purpose;
  ws.getCell("K2").fill = orange;
  ws.getCell("K2").alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells("O2:P2");
  ws.getCell("O2").value = "TAR Number (travel team)";
  ws.getCell("Q2").value = trip.returnDate
    ? `TR Due: ${formatLongDate(addDays(trip.returnDate, 14))}`
    : "";

  const headers = [
    "Loc. #",
    "Date",
    "Location",
    "Consecutive Days @ Location",
    "Per Diem Adjust",
    "Daily MI&E Rate",
    "Adjusted MI&E",
    "Max Daily Lodging",
    "Adjusted/Actual Lodging",
    "Airfare (inc. agent fees)",
    "Baggage",
    "Rental Vehicle",
    "Rental Fuel",
    "POV Mileage Input # of miles",
    "POV Cost",
    "Rail, Uber, Taxi, Train, Tolls, Parking",
    "Other (CONUS Lodging Taxes/Fees, Excess Baggage, etc.)",
    "Other breakout (must sum to Other)",
    "Comments / Variance Notes",
  ];
  headers.forEach((h, i) => {
    const cell = ws.getCell(3, i + 1);
    cell.value = h;
    cell.fill = headerFill;
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 9 };
    cell.alignment = { wrapText: true, vertical: "middle" };
    cell.border = border;
  });
  ws.getRow(3).height = 36;

  rows.forEach((row, i) => {
    const r = 4 + i;
    const t = rowTotals(row);
    const values = [
      row.locLabel,
      excelDate(row.date),
      row.location,
      row.consecutive,
      row.perDiemAdjust,
      money(row.mieRate),
      money(t.mie),
      money(row.lodgingMax),
      money(t.lodging),
      money(row.airfare) || null,
      money(row.baggage) || null,
      money(row.rental) || null,
      money(row.rentalFuel) || null,
      row.povMiles || null,
      money(t.pov),
      money(row.ground) || null,
      money(row.other) || null,
      formatOtherBreakout(row.otherItems) || null,
      row.comments,
    ];
    values.forEach((val, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = val;
      cell.border = border;
      cell.alignment = { wrapText: true, vertical: "middle" };
      if (c + 1 === 5 && typeof val === "number") {
        cell.numFmt = "0.00";
      } else if ([6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17].includes(c + 1) && typeof val === "number") {
        cell.numFmt = '"$"#,##0.00';
      }
      if (c + 1 === 2 && val instanceof Date) cell.numFmt = "D-MMM-YY";
      const inputCols = [1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19];
      cell.fill = inputCols.includes(c + 1) ? orange : grey;
    });
    ws.getCell(r, 7).value = { formula: `F${r}*E${r}` };
    ws.getCell(r, 15).value = { formula: `N${r}*${row.povRate}` };
  });

  ws.getRow(2).height = 48;
  const widths = [10, 12, 22, 12, 12, 12, 12, 12, 12, 12, 10, 12, 10, 12, 12, 16, 14, 36, 32];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const noteRow = 5 + rows.length;
  ws.mergeCells(`A${noteRow}:S${noteRow + 2}`);
  ws.getCell(`A${noteRow}`).value =
    `Generated locally for ETAS TAR (estimates). Submit this workbook plus the required-docs packet to ETAS_travel@hii.com. ` +
    `Do not book until the Deputy Program Manager approves the EA. POV rate used: $${trip.expenses.povRate.toFixed(3)}/mi. ` +
    `Per diem lookups: GSA FY2026 CONUS table bundled in the app; traveler may overwrite. Not the Costpoint system of record.`;
  ws.getCell(`A${noteRow}`).alignment = { wrapText: true, vertical: "top" };
  ws.getRow(noteRow).height = 48;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const name = `ETAS_TW_${safe(trip.travelerName) || "traveler"}_${safe(trip.project) || "project"}.xlsx`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function excelDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
}

