import * as XLSX from "xlsx";
import type { DirectorSubmission, ReviewStatus } from "./directorStore";

type AggregateStats = {
  total: number;
  reviewed: number;
  followUp: number;
  pending: number;
  completion: number;
};

export type AggregateExcelInput = {
  rows: DirectorSubmission[];
  stats: AggregateStats;
  title: string;
  filterDescription: string;
  directorName: string;
};

const reviewLabels: Record<ReviewStatus, string> = {
  new: "بانتظار المراجعة",
  reviewed: "تمت المراجعة",
  follow_up: "يحتاج متابعة",
};

const academicTermLabels = {
  "": "غير محدد",
  "الأول": "الفصل الدراسي الأول",
  "الثاني": "الفصل الدراسي الثاني",
  "العام الدراسي": "العام الدراسي",
  "الصيفي": "العام الدراسي",
};

const formatDate = (value: string) => new Date(value).toLocaleDateString("ar-SA", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const createAggregateReportExcel = async ({ rows, stats, title, filterDescription, directorName }: AggregateExcelInput) => {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };

  const summarySheet = XLSX.utils.aoa_to_sheet([
    [title || "تقرير متابعة إنجازات المعلمين"],
    [],
    ["الفترة والنطاق", filterDescription],
    ["أعده", directorName || "مدير/ة المدرسة"],
    ["تاريخ إنشاء الملف", formatDate(new Date().toISOString())],
    [],
    ["المؤشر", "القيمة"],
    ["إجمالي الملفات", stats.total],
    ["تمت المراجعة", stats.reviewed],
    ["تحتاج متابعة", stats.followUp],
    ["بانتظار المراجعة", stats.pending],
    ["نسبة الإنجاز", `${stats.completion}%`],
  ]);
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 72 }];

  const resultSheet = XLSX.utils.aoa_to_sheet([
    ["المعلم/ة", "اسم الملف", "الفصل الدراسي", "حالة المراجعة", "التقدير", "تاريخ الاستيراد", "آخر تحديث", "تعليق المدير"],
    ...rows.map((item) => [
      item.teacherName,
      item.fileName,
      academicTermLabels[item.academicTerm || ""],
      reviewLabels[item.reviewStatus],
      item.reviewLevel || "لم يحدد",
      formatDate(item.importedAt),
      formatDate(item.updatedAt),
      item.comment || "",
    ]),
  ]);
  resultSheet["!cols"] = [{ wch: 24 }, { wch: 30 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 48 }];
  resultSheet["!autofilter"] = { ref: `A1:H${Math.max(1, rows.length + 1)}` };

  XLSX.utils.book_append_sheet(workbook, summarySheet, "ملخص التقرير");
  XLSX.utils.book_append_sheet(workbook, resultSheet, "النتائج المفلترة");

  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array", compression: true });
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};
