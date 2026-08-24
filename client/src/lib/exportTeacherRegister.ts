import * as XLSX from "xlsx";
import type { DirectorSubmission, ReviewStatus } from "./directorStore";

const reviewLabels: Record<ReviewStatus, string> = {
  new: "بانتظار المراجعة",
  reviewed: "تمت المراجعة",
  follow_up: "يحتاج متابعة",
};

const academicTermLabels: Record<string, string> = {
  "": "غير محدد",
  "الأول": "الفصل الدراسي الأول",
  "الثاني": "الفصل الدراسي الثاني",
  "العام الدراسي": "العام الدراسي",
  "الصيفي": "العام الدراسي",
};

const formatDate = (value: string) => new Date(value).toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" });
const protectSpreadsheetValue = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value;

export const teacherRegisterHeaders = ["المعلم/ة", "اسم الملف", "الفصل الدراسي", "حالة المراجعة", "التقدير", "تاريخ الاستيراد", "آخر تحديث", "تعليق المدير"];

export const teacherRegisterRows = (rows: DirectorSubmission[]) => rows.map((item) => [
  item.teacherName,
  item.fileName,
  academicTermLabels[item.academicTerm || ""] || "غير محدد",
  reviewLabels[item.reviewStatus],
  item.reviewLevel || "لم يحدد",
  formatDate(item.importedAt),
  formatDate(item.updatedAt),
  item.comment || "",
].map((value) => protectSpreadsheetValue(String(value))));

export const createTeacherRegisterCsv = (rows: DirectorSubmission[]) => {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [teacherRegisterHeaders, ...teacherRegisterRows(rows)].map((row) => row.map(escape).join(",")).join("\r\n");
  return new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
};

export const createTeacherRegisterExcel = async (rows: DirectorSubmission[]) => {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  const sheet = XLSX.utils.aoa_to_sheet([teacherRegisterHeaders, ...teacherRegisterRows(rows)]);
  sheet["!cols"] = [{ wch: 24 }, { wch: 30 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 48 }];
  sheet["!autofilter"] = { ref: `A1:H${Math.max(1, rows.length + 1)}` };
  XLSX.utils.book_append_sheet(workbook, sheet, "سجل المعلمين");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};
