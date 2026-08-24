import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

const input = process.argv[2];
if (!input) throw new Error("Expected the XLSX file path as the first argument");

const workbook = XLSX.read(await readFile(input), { type: "buffer" });
if (workbook.SheetNames.join("|") !== "ملخص التقرير|النتائج المفلترة") throw new Error("Aggregate workbook sheets are incomplete");
if (workbook.Sheets["النتائج المفلترة"]?.A2?.v !== "أمل السهلي") throw new Error("Filtered teacher row is absent from the aggregate workbook");
if (!String(workbook.Sheets["ملخص التقرير"]?.B3?.v || "").includes("الفصل الدراسي: الفصل الدراسي الأول")) throw new Error("Aggregate workbook does not disclose the active filter scope");
const summaryValues = Object.values(workbook.Sheets["ملخص التقرير"] || {}).map((cell) => String(cell?.v || "")).join("|");
if (summaryValues.includes("أُعد محليًا على جهاز المدير فقط")) throw new Error("Aggregate workbook still includes internal local-only copy");
console.log("Aggregate filtered workbook passed");
