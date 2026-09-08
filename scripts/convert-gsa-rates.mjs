/**
 * One-off converter used to build public/rates/*.json from GSA XLSX files.
 * A fuller maintainer script (download + refresh) is tracked as a GitHub issue.
 *
 * Usage:
 *   node scripts/convert-gsa-rates.mjs
 */
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public/rates");

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object" && "text" in value) return String(value.text);
  if (typeof value === "object" && "result" in value) return String(value.result ?? "");
  return String(value);
}

function parseMd(raw) {
  const text = cellText(raw).trim();
  const m = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return { m: month, d: Number(m[2]), y: Number(m[3]) };
}

function yearRound(begin, end, fy) {
  if (!begin || !end) return true;
  return begin.m === 10 && begin.d === 1 && begin.y === fy - 1 && end.m === 9 && end.d === 30 && end.y === fy;
}

async function convertRates(xlsxPath, fy, source, url) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  const standardRow = ws.getRow(3);
  const standard = {
    lodging: Number(standardRow.getCell(6).value),
    mie: Number(standardRow.getCell(7).value),
  };
  const localities = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const state = cellText(row.getCell(1).value).trim().toUpperCase();
    const destination = cellText(row.getCell(2).value).trim();
    if (!state || !destination) continue;
    const begin = parseMd(row.getCell(4).value);
    const end = parseMd(row.getCell(5).value);
    const fullYear = yearRound(begin, end, fy);
    localities.push({
      id: String(localities.length + 1),
      state,
      destination,
      county: cellText(row.getCell(3).value).trim(),
      seasonBegin: fullYear || !begin ? null : { m: begin.m, d: begin.d },
      seasonEnd: fullYear || !end ? null : { m: end.m, d: end.d },
      lodging: Number(row.getCell(6).value),
      mie: Number(row.getCell(7).value),
    });
  }
  const book = {
    source,
    url,
    effectiveFrom: `${fy - 1}-10-01`,
    effectiveTo: `${fy}-09-30`,
    fiscalYear: fy,
    standard,
    localities,
  };
  const dest = join(outDir, `conus-fy${fy}.json`);
  await writeFile(dest, `${JSON.stringify(book)}\n`);
  console.log("wrote", dest, localities.length, "localities", standard);
}

async function convertZips(xlsxPath, fy) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  /** @type {Record<string, string>} */
  const z = {};
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const zip = cellText(row.getCell(6).value).trim().padStart(5, "0");
    const city = cellText(row.getCell(2).value).trim();
    const state = cellText(row.getCell(5).value).trim().toUpperCase();
    if (!/^\d{5}$/.test(zip) || !state) continue;
    z[zip] = `${city}|${state}`;
  }
  const dest = join(outDir, `zip-fy${fy}.json`);
  const payload = { fiscalYear: fy, z };
  await writeFile(dest, `${JSON.stringify(payload)}\n`);
  console.log("wrote", dest, Object.keys(z).length, "zips");
}

await convertRates(
  "/tmp/gsa-rates/fy27-rates.xlsx",
  2027,
  "GSA FY2027 Per Diem Rates",
  "https://www.gsa.gov/system/files/FY2027_PerDiemRates_Validated090126.xlsx",
);
await convertZips("/tmp/gsa-rates/fy26-zips.xlsx", 2026);
await convertZips("/tmp/gsa-rates/fy27-zips.xlsx", 2027);
await writeFile(
  join(outDir, "manifest.json"),
  `${JSON.stringify({ fiscalYears: [2026, 2027] }, null, 2)}\n`,
);
console.log("wrote manifest");
