import type { AcademicTerm, DirectorSubmission } from "./directorStore";

export type ReportScope = "all" | "reviewed" | "follow_up";

export const reportScopeLabels: Record<ReportScope, string> = {
  all: "كل الملفات",
  reviewed: "تمت مراجعتها",
  follow_up: "تحتاج متابعة",
};

export type ReportFilterOptions = {
  scope: ReportScope;
  startDate: string;
  endDate: string;
  academicTerm: AcademicTerm;
  teacherNameQuery: string;
};

const formatInputDate = (value: string) => new Date(`${value}T00:00:00.000Z`).toLocaleDateString("ar-SA", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const hasInvalidDateRange = (startDate: string, endDate: string) => Boolean(startDate && endDate && startDate > endDate);

export const normalizeTeacherName = (value: string) => value
  .trim()
  .toLocaleLowerCase("ar")
  .normalize("NFD")
  .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
  .replace(/[أإآ]/g, "ا")
  .replace(/ى/g, "ي")
  .replace(/ة/g, "ه");

export const filterReportRows = (submissions: DirectorSubmission[], options: ReportFilterOptions) => {
  if (hasInvalidDateRange(options.startDate, options.endDate)) return [];
  const normalizedTeacherNameQuery = normalizeTeacherName(options.teacherNameQuery);

  return submissions.filter((item) => {
    const importedDay = item.importedAt.slice(0, 10);
    return (options.scope === "all" || item.reviewStatus === options.scope)
      && (!options.startDate || importedDay >= options.startDate)
      && (!options.endDate || importedDay <= options.endDate)
      && (!options.academicTerm || item.academicTerm === options.academicTerm)
      && (!normalizedTeacherNameQuery || normalizeTeacherName(item.teacherName).includes(normalizedTeacherNameQuery));
  }).sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ar"));
};

export const buildReportFilterDescription = (options: ReportFilterOptions, academicTermLabel: (term: AcademicTerm) => string) => {
  if (hasInvalidDateRange(options.startDate, options.endDate)) return "النطاق الزمني غير صالح";

  const details = [
    options.scope !== "all" ? `حالة المراجعة: ${reportScopeLabels[options.scope]}` : "",
    options.startDate && options.endDate ? `تاريخ الاستيراد: من ${formatInputDate(options.startDate)} إلى ${formatInputDate(options.endDate)}` : options.startDate ? `تاريخ الاستيراد: من ${formatInputDate(options.startDate)}` : options.endDate ? `تاريخ الاستيراد: حتى ${formatInputDate(options.endDate)}` : "",
    options.academicTerm ? `الفصل الدراسي: ${academicTermLabel(options.academicTerm)}` : "",
    options.teacherNameQuery.trim() ? `اسم المعلم: ${options.teacherNameQuery.trim()}` : "",
  ].filter(Boolean);

  return details.join(" · ") || "كل المعلمين وتواريخ الاستيراد والفصول الدراسية";
};
