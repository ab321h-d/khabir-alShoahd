import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PHASE ID-3D.2: اختبارات إنتاجية حقيقية — تستدعي validateTeacherIdentityMetadata
 * وresolveStableTeacherIdentity وdirectorStore.save() الفعلية نفسها التي
 * يستخدمها Director.tsx، لا نسخًا مكرَّرة داخل الاختبار. license/licenseGuard
 * تُموَّه فقط (write guard عام غير متعلق بمنطق هذه المرحلة إطلاقًا).
 */
vi.mock("./license/licenseGuard", () => ({ assertWriteAllowed: vi.fn(async () => {}) }));

const { validateTeacherIdentityMetadata, resolveStableTeacherIdentity } = await import("./teacherIdentityImport");
const { directorStore } = await import("./directorStore");

const validIdentity = {
  schemaVersion: 1 as const,
  exportId: "export-0001",
  teacherId: "user-abc-123",
  schoolId: "2002",
  stage: "middle" as const,
  displayName: "أ. نورة القحطاني",
  generatedAt: "2026-09-09T00:00:00.000Z",
};

const validCompleteness = {
  schemaVersion: 1 as const,
  exportId: "export-0001",
  generatedAt: "2026-09-09T00:00:00.000Z",
  performanceAreas: [],
  totals: { areasCount: 0, completeCount: 0, needsReviewCount: 0, incompleteCount: 0 },
};

// ===== 1-7: validateTeacherIdentityMetadata =====

describe("validateTeacherIdentityMetadata", () => {
  it("1) يقبل بيانات صالحة بالضبط", () => {
    expect(validateTeacherIdentityMetadata(validIdentity)).toEqual(validIdentity);
  });

  it("2) يرفض حقلًا إضافيًا غير معتمَد", () => {
    expect(validateTeacherIdentityMetadata({ ...validIdentity, extra: "x" })).toBeNull();
  });

  it("3) يرفض بيانات غير كائن/تالفة", () => {
    expect(validateTeacherIdentityMetadata(null)).toBeNull();
    expect(validateTeacherIdentityMetadata("string")).toBeNull();
    expect(validateTeacherIdentityMetadata(42)).toBeNull();
    expect(validateTeacherIdentityMetadata([])).toBeNull();
  });

  it("4) يرفض schemaVersion غير مدعوم", () => {
    expect(validateTeacherIdentityMetadata({ ...validIdentity, schemaVersion: 2 })).toBeNull();
  });

  it("5) يرفض stage غير صالحة", () => {
    expect(validateTeacherIdentityMetadata({ ...validIdentity, stage: "invalid" })).toBeNull();
  });

  it("6) يرفض teacherId/schoolId/displayName/exportId فارغة", () => {
    expect(validateTeacherIdentityMetadata({ ...validIdentity, teacherId: "" })).toBeNull();
    expect(validateTeacherIdentityMetadata({ ...validIdentity, schoolId: "" })).toBeNull();
    expect(validateTeacherIdentityMetadata({ ...validIdentity, displayName: "" })).toBeNull();
    expect(validateTeacherIdentityMetadata({ ...validIdentity, exportId: "" })).toBeNull();
  });

  it("7) يرفض generatedAt غير صالح", () => {
    expect(validateTeacherIdentityMetadata({ ...validIdentity, generatedAt: "not-a-date" })).toBeNull();
  });
});

// ===== 8-21: Director import/storage (production logic) =====

const resetDirectorDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase("khabir-director-local");
  request.onsuccess = () => resolve();
  request.onerror = () => resolve();
  request.onblocked = () => resolve();
});

beforeEach(async () => { await resetDirectorDatabase(); });

describe("Director import/storage — teacherIdentity عبر resolveStableTeacherIdentity + directorStore.save الفعليتين", () => {
  it("8) ZIP جديد + identity صالحة + completeness متطابقة -> teacherId ثابت يُخزَّن", async () => {
    const resolved = resolveStableTeacherIdentity(validIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "portfolio.pdf", { type: "application/pdf" }), "معلم اختبار", "", validCompleteness, resolved);
    expect(submission.teacherId).toBe("user-abc-123");
  });

  it("9) teacherId المُخزَّن يساوي identity.teacherId حرفيًا", async () => {
    const resolved = resolveStableTeacherIdentity(validIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", validCompleteness, resolved);
    expect(submission.teacherId).toBe(validIdentity.teacherId);
  });

  it("10) schoolId/stage/teacherDisplayName/exportId/identityGeneratedAt تُخزَّن بدقة", async () => {
    const resolved = resolveStableTeacherIdentity(validIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", validCompleteness, resolved);
    expect(submission.schoolId).toBe("2002");
    expect(submission.stage).toBe("middle");
    expect(submission.teacherDisplayName).toBe("أ. نورة القحطاني");
    expect(submission.exportId).toBe("export-0001");
    expect(submission.identityGeneratedAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("11) ZIP قديم بلا identity -> استيراد بلا هوية ثابتة", async () => {
    const resolved = resolveStableTeacherIdentity(null, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", validCompleteness, resolved);
    expect(submission.teacherId).toBeUndefined();
  });

  it("12) PDF مباشر -> استيراد بلا هوية ثابتة", async () => {
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", null, null);
    expect(submission.teacherId).toBeUndefined();
  });

  it("13) identity تالفة (JSON.parse يفشل) -> استيراد ينجح بلا هوية ثابتة", async () => {
    let parsedIdentity: ReturnType<typeof validateTeacherIdentityMetadata> = null;
    try { JSON.parse("{not valid json"); } catch { parsedIdentity = null; }
    const resolved = resolveStableTeacherIdentity(parsedIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", validCompleteness, resolved);
    expect(submission.teacherId).toBeUndefined();
  });

  it("14) schemaVersion غير مدعوم -> استيراد ينجح بلا هوية ثابتة", async () => {
    const parsedIdentity = validateTeacherIdentityMetadata({ ...validIdentity, schemaVersion: 2 });
    const resolved = resolveStableTeacherIdentity(parsedIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", validCompleteness, resolved);
    expect(submission.teacherId).toBeUndefined();
  });

  it("15) exportId mismatch -> استيراد ينجح بلا هوية ثابتة", async () => {
    const mismatched = { ...validCompleteness, exportId: "different-export-id" };
    const resolved = resolveStableTeacherIdentity(validIdentity, mismatched);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", mismatched, resolved);
    expect(submission.teacherId).toBeUndefined();
  });

  it("16) generatedAt mismatch -> استيراد ينجح بلا هوية ثابتة", async () => {
    const mismatched = { ...validCompleteness, generatedAt: "2020-01-01T00:00:00.000Z" };
    const resolved = resolveStableTeacherIdentity(validIdentity, mismatched);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", mismatched, resolved);
    expect(submission.teacherId).toBeUndefined();
  });

  it("17) completeness مفقودة/غير صالحة + identity صالحة -> استيراد ينجح بلا هوية ثابتة", async () => {
    const resolved = resolveStableTeacherIdentity(validIdentity, null);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", null, resolved);
    expect(submission.teacherId).toBeUndefined();
  });

  it("18) teacherName لا يُستخدَم لتوليد teacherId إطلاقًا", async () => {
    const resolved = resolveStableTeacherIdentity(validIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "اسم لا علاقة له بالمعرّف إطلاقًا", "", validCompleteness, resolved);
    expect(submission.teacherId).toBe(validIdentity.teacherId);
    expect(submission.teacherId).not.toContain("اسم");
  });

  it("19) identity.displayName لا يستبدل teacherName الأصلي", async () => {
    const resolved = resolveStableTeacherIdentity(validIdentity, validCompleteness);
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "الاسم النصي القديم", "", validCompleteness, resolved);
    expect(submission.teacherName).toBe("الاسم النصي القديم");
    expect(submission.teacherDisplayName).toBe("أ. نورة القحطاني");
    expect(submission.teacherName).not.toBe(submission.teacherDisplayName);
  });

  it("20) سلوك completeness الحالي بلا تغيير", async () => {
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", validCompleteness, null);
    expect(submission.completenessMetadata).toEqual(validCompleteness);
  });

  it("21) صفر auto-claim بالاسم — استدعاءان بنفس teacherName ينتجان تسليمين بلا أي هوية مشتركة تلقائية", async () => {
    const s1 = await directorStore.save(new File(["%PDF"], "p1.pdf"), "نفس الاسم", "", null, null);
    const s2 = await directorStore.save(new File(["%PDF"], "p2.pdf"), "نفس الاسم", "", null, null);
    expect(s1.teacherId).toBeUndefined();
    expect(s2.teacherId).toBeUndefined();
    expect(s1.id).not.toBe(s2.id);
  });
});
