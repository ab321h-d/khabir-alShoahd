import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createAggregateReportExcel } from "./exportAggregateExcel";

describe("createAggregateReportExcel", () => {
  it("ينشئ مصنف Excel بملخص ونطاق ونتائج مفلترة", async () => {
    const blob = await createAggregateReportExcel({
      title: "تقرير متابعة المدرسة",
      filterDescription: "الفصل الدراسي: الفصل الدراسي الأول · اسم المعلم: أمل",
      directorName: "مديرة المدرسة",
      stats: { total: 1, reviewed: 1, followUp: 0, pending: 0, completion: 100 },
      rows: [{ id: "one", fileName: "أمل.pdf", teacherName: "أمل السهلي", importedAt: "2026-08-17T09:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z", size: 10, reviewStatus: "reviewed", reviewLevel: "متميز", academicTerm: "الأول", comment: "ملف مرتب" }],
    });

    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    expect(workbook.SheetNames).toEqual(["ملخص التقرير", "النتائج المفلترة"]);
    expect(workbook.Sheets["ملخص التقرير"]?.B3?.v).toContain("اسم المعلم: أمل");
    expect(Object.values(workbook.Sheets["ملخص التقرير"] || {}).map((cell) => String(cell?.v || "")).join("|")).not.toContain("أُعد محليًا على جهاز المدير فقط");
    expect(workbook.Sheets["النتائج المفلترة"]?.A2?.v).toBe("أمل السهلي");
    expect(workbook.Sheets["النتائج المفلترة"]?.H2?.v).toBe("ملف مرتب");
  });

  it("يعرض العام الدراسي للقيمة الجديدة ولسجل الفصل الصيفي القديم", async () => {
    const blob = await createAggregateReportExcel({
      title: "تقرير متابعة المدرسة",
      filterDescription: "الفترة: العام الدراسي",
      directorName: "مديرة المدرسة",
      stats: { total: 2, reviewed: 0, followUp: 0, pending: 2, completion: 0 },
      rows: [
        { id: "year", fileName: "سارة.pdf", teacherName: "سارة", importedAt: "2026-08-17T09:00:00.000Z", updatedAt: "2026-08-17T09:00:00.000Z", size: 10, reviewStatus: "new", reviewLevel: "", academicTerm: "العام الدراسي", comment: "" },
        { id: "legacy-summer", fileName: "ليان.pdf", teacherName: "ليان", importedAt: "2026-08-17T09:00:00.000Z", updatedAt: "2026-08-17T09:00:00.000Z", size: 10, reviewStatus: "new", reviewLevel: "", academicTerm: "الصيفي", comment: "" },
      ],
    });

    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    expect(workbook.Sheets["النتائج المفلترة"]?.C2?.v).toBe("العام الدراسي");
    expect(workbook.Sheets["النتائج المفلترة"]?.C3?.v).toBe("العام الدراسي");
  });
});
