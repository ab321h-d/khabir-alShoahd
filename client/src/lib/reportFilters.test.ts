import { describe, expect, it } from "vitest";
import type { DirectorSubmission } from "./directorStore";
import { buildReportFilterDescription, filterReportRows, hasInvalidDateRange, normalizeTeacherName } from "./reportFilters";

const submissions: DirectorSubmission[] = [
  { id: "one", fileName: "a.pdf", teacherName: "أمل السهلي", importedAt: "2026-08-15T09:00:00.000Z", updatedAt: "2026-08-15T10:00:00.000Z", size: 10, reviewStatus: "reviewed", reviewLevel: "متميز", academicTerm: "الأول", comment: "" },
  { id: "two", fileName: "b.pdf", teacherName: "سارة الحربي", importedAt: "2026-08-17T09:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z", size: 10, reviewStatus: "follow_up", reviewLevel: "", academicTerm: "الثاني", comment: "" },
];

describe("reportFilters", () => {
  it("يجمع شروط حالة المراجعة والتاريخ والفصل الدراسي محليًا", () => {
    const filtered = filterReportRows(submissions, { scope: "reviewed", startDate: "2026-08-15", endDate: "2026-08-15", academicTerm: "الأول", teacherNameQuery: "" });
    expect(filtered.map((item) => item.id)).toEqual(["one"]);
  });

  it("يستبعد الملفات عند إدخال نطاق تاريخ غير صالح", () => {
    expect(hasInvalidDateRange("2026-08-18", "2026-08-17")).toBe(true);
    expect(filterReportRows(submissions, { scope: "all", startDate: "2026-08-18", endDate: "2026-08-17", academicTerm: "", teacherNameQuery: "" })).toEqual([]);
  });

  it("يوضح الفلاتر المختارة ضمن سياق التقرير", () => {
    const description = buildReportFilterDescription({ scope: "all", startDate: "", endDate: "", academicTerm: "الثاني", teacherNameQuery: "" }, (term) => term === "الثاني" ? "الفصل الدراسي الثاني" : "غير محدد");
    expect(description).toBe("الفصل الدراسي: الفصل الدراسي الثاني");
  });

  it("يبحث باسم المعلم جزئيًا مع توحيد أشكال الحروف العربية", () => {
    const filtered = filterReportRows(submissions, { scope: "all", startDate: "", endDate: "", academicTerm: "", teacherNameQuery: "امل" });
    expect(filtered.map((item) => item.teacherName)).toEqual(["أمل السهلي"]);
    expect(normalizeTeacherName("أَمَل السهلي")).toBe(normalizeTeacherName("امل السهلى"));
  });

  it("يضيف اسم المعلم إلى وصف نطاق التقرير", () => {
    const description = buildReportFilterDescription({ scope: "all", startDate: "", endDate: "", academicTerm: "", teacherNameQuery: "أمل" }, () => "غير محدد");
    expect(description).toBe("اسم المعلم: أمل");
  });
});
