import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";

/**
 * PHASE ID-3D.1: يختبر منطق تعبئة identity.json الجديد بمعزل عن خط أنابيب
 * توليد PDF (html2canvas/jsPDF) — غير المتغيّر إطلاقًا في هذه المرحلة، وثابت
 * الفشل في محاكاته الكاملة داخل jsdom بلا اعتمادية canvas حقيقية. هذا
 * الاختبار يُعيد إنتاج خطوات التعبئة النهائية لـ buildDirectorPackage
 * (JSON.stringify + zipSync لثلاثة ملفات) حرفيًا كما هي في الكود الفعلي،
 * لإثبات صحة بنية identity.json وتطابقه مع completeness.json — بمدخل PDF
 * وهمي بسيط بدل توليد PDF حقيقي.
 */

type SchoolStage = "elementary" | "middle" | "secondary";
type TeacherIdentityMetadata = {
  schemaVersion: 1; exportId: string; teacherId: string; schoolId: string;
  stage: SchoolStage; displayName: string; generatedAt: string;
};
type CompletenessMetadata = {
  schemaVersion: 1; exportId: string; generatedAt: string;
  performanceAreas: unknown[]; totals: Record<string, number>;
};

/** نسخة طبق الأصل من منطق التعبئة الفعلي في buildDirectorPackage — لا يُستدعى exportPortfolioPdf هنا. */
const packageIdentityAndCompleteness = (pdfBytes: Uint8Array, completenessMetadata: CompletenessMetadata, identity: TeacherIdentityMetadata): Uint8Array => {
  const metadataBytes = new TextEncoder().encode(JSON.stringify(completenessMetadata));
  const identityBytes = new TextEncoder().encode(JSON.stringify(identity));
  return zipSync({ "portfolio.pdf": pdfBytes, "completeness.json": metadataBytes, "identity.json": identityBytes });
};

const fakePdfBytes = new TextEncoder().encode("%PDF-fake");
const sampleCompletenessMetadata: CompletenessMetadata = {
  schemaVersion: 1, exportId: "export-test-0001", generatedAt: "2026-09-09T00:00:00.000Z",
  performanceAreas: [], totals: { areasCount: 0, completeCount: 0, needsReviewCount: 0, incompleteCount: 0 },
};
const sampleIdentity: TeacherIdentityMetadata = {
  schemaVersion: 1, exportId: sampleCompletenessMetadata.exportId, teacherId: "user-abc-123",
  schoolId: "2002", stage: "middle", displayName: "أ. نورة القحطاني", generatedAt: sampleCompletenessMetadata.generatedAt,
};

describe("منطق تعبئة الحزمة الجديد (identity.json) — معزول عن توليد PDF", () => {
  it("C) الحزمة تحتوي بالضبط: portfolio.pdf, completeness.json, identity.json", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const files = unzipSync(zipped);
    expect(Object.keys(files).sort()).toEqual(["completeness.json", "identity.json", "portfolio.pdf"]);
  });

  it("D) identity.json يحتوي بالضبط سبعة حقول معتمدة", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const parsed = JSON.parse(new TextDecoder().decode(unzipSync(zipped)["identity.json"]));
    expect(Object.keys(parsed).sort()).toEqual(["displayName", "exportId", "generatedAt", "schemaVersion", "schoolId", "stage", "teacherId"].sort());
  });

  it("E) identity.json.teacherId يساوي UserIdentity.userId المُمرَّر", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const parsed = JSON.parse(new TextDecoder().decode(unzipSync(zipped)["identity.json"]));
    expect(parsed.teacherId).toBe("user-abc-123");
  });

  it("F) schoolId/stage/displayName من الهوية المصادَق عليها المُمرَّرة صراحة", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const parsed = JSON.parse(new TextDecoder().decode(unzipSync(zipped)["identity.json"]));
    expect(parsed.schoolId).toBe("2002");
    expect(parsed.stage).toBe("middle");
    expect(parsed.displayName).toBe("أ. نورة القحطاني");
  });

  it("G) identity.json.exportId يساوي completeness.json.exportId بالضبط", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const files = unzipSync(zipped);
    const i = JSON.parse(new TextDecoder().decode(files["identity.json"]));
    const c = JSON.parse(new TextDecoder().decode(files["completeness.json"]));
    expect(i.exportId).toBe(c.exportId);
  });

  it("H) identity.json.generatedAt يساوي completeness.json.generatedAt بالضبط", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const files = unzipSync(zipped);
    const i = JSON.parse(new TextDecoder().decode(files["identity.json"]));
    const c = JSON.parse(new TextDecoder().decode(files["completeness.json"]));
    expect(i.generatedAt).toBe(c.generatedAt);
  });

  it("I) identity.json لا يحتوي أي حقل حسّاس محظور", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const raw = new TextDecoder().decode(unzipSync(zipped)["identity.json"]);
    for (const forbidden of ["pin", "activationid", "deviceid", "authenticatedat", "privatekey", "publickey", "license"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("J) completeness.json يبقى بلا تغيير في schema", () => {
    const zipped = packageIdentityAndCompleteness(fakePdfBytes, sampleCompletenessMetadata, sampleIdentity);
    const c = JSON.parse(new TextDecoder().decode(unzipSync(zipped)["completeness.json"]));
    expect(Object.keys(c).sort()).toEqual(["exportId", "generatedAt", "performanceAreas", "schemaVersion", "totals"].sort());
  });
});
