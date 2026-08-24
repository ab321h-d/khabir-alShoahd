import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { createTeacherRegisterCsv, createTeacherRegisterExcel, teacherRegisterHeaders } from "./exportTeacherRegister";
import type { DirectorSubmission } from "./directorStore";

const submission: DirectorSubmission = { id: "teacher-1", teacherName: "أمل السهلي", fileName: "ملف-أمل.pdf", importedAt: "2026-08-21T07:00:00.000Z", updatedAt: "2026-08-21T08:00:00.000Z", size: 1200, reviewStatus: "follow_up", reviewLevel: "يحتاج متابعة", academicTerm: "العام الدراسي", comment: "=تنبيه" };

describe("teacher register exports", () => {
  it("creates a UTF-8 CSV containing the local teacher register with safe values", async () => {
    const blob = createTeacherRegisterCsv([submission]);
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = await blob.text();
    expect(csv).toContain("المعلم/ة");
    expect(csv).toContain("أمل السهلي");
    expect(csv).toContain("يحتاج متابعة");
    expect(csv).toContain("'=تنبيه");
  });

  it("creates an RTL Excel register with the expected columns and rows", async () => {
    const blob = await createTeacherRegisterExcel([submission]);
    const workbook = XLSX.read(await blob.arrayBuffer(), { type: "array" });
    expect(workbook.SheetNames).toEqual(["سجل المعلمين"]);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets["سجل المعلمين"], { header: 1 });
    expect(rows[0]).toEqual(teacherRegisterHeaders);
    expect(rows[1]).toContain("أمل السهلي");
    expect(rows[1]).toContain("العام الدراسي");
    expect(rows[1]).toContain("يحتاج متابعة");
  });
});
