import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PHASE ID-3E: اختبارات إنتاجية حقيقية على directorStore.save/
 * getTeacherContactByIdentity/upsertTeacherContactByIdentity/
 * getTeacherContact/upsertTeacherContact الفعلية نفسها.
 */
vi.mock("./license/licenseGuard", () => ({ assertWriteAllowed: vi.fn(async () => {}) }));

const { directorStore, normalizeTeacherName } = await import("./directorStore");

const identityFor = (teacherId: string, displayName = "معلم") => ({
  schemaVersion: 1 as const, exportId: "export-1", teacherId, schoolId: "2002", stage: "middle" as const,
  displayName, generatedAt: "2026-09-09T00:00:00.000Z",
});
const completeness = { schemaVersion: 1 as const, exportId: "export-1", generatedAt: "2026-09-09T00:00:00.000Z", performanceAreas: [], totals: { areasCount: 0, completeCount: 0, needsReviewCount: 0, incompleteCount: 0 } };

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase("khabir-director-local");
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });

describe("ID-3E — جهة اتصال بهوية ثابتة (teacherId) بلا تصادم اسم", () => {
  it("1-2) معلمان بنفس teacherName، teacherId مختلف -> كل واحد يقرأ رقمه فقط، تحديث أحدهما لا يمس الآخر", async () => {
    await directorStore.upsertTeacherContactByIdentity("teacher-a", "9665000001");
    await directorStore.upsertTeacherContactByIdentity("teacher-b", "9665000002");
    expect(await directorStore.getTeacherContactByIdentity("teacher-a")).toBe("9665000001");
    expect(await directorStore.getTeacherContactByIdentity("teacher-b")).toBe("9665000002");

    await directorStore.upsertTeacherContactByIdentity("teacher-a", "9665000099");
    expect(await directorStore.getTeacherContactByIdentity("teacher-a")).toBe("9665000099");
    expect(await directorStore.getTeacherContactByIdentity("teacher-b")).toBe("9665000002");
  });

  it("3) Legacy submission بلا teacherId يستمر بمسار teacherContacts القديم بالاسم", async () => {
    const normalized = normalizeTeacherName("محمد");
    await directorStore.upsertTeacherContact(normalized, "9665111111");
    expect(await directorStore.getTeacherContact(normalized)).toBe("9665111111");
  });

  it("4) teacherId موجود بلا identity contact + وجود legacy contact لنفس الاسم -> لا قراءة للرقم القديم بالاسم (يبقى null)", async () => {
    const normalized = normalizeTeacherName("محمد");
    await directorStore.upsertTeacherContact(normalized, "9665111111"); // legacy موجود
    // لا upsertTeacherContactByIdentity لـ"teacher-c" — سجل الهوية غائب عمدًا
    const result = await directorStore.getTeacherContactByIdentity("teacher-c");
    expect(result).toBeNull();
  });

  it("5) F5/إعادة فتح: identity contact يبقى محفوظًا (فتح اتصال IndexedDB جديد)", async () => {
    await directorStore.upsertTeacherContactByIdentity("teacher-x", "9665222222");
    // محاكاة F5: استدعاء جديد كليًا بلا أي حالة سابقة في الذاكرة
    expect(await directorStore.getTeacherContactByIdentity("teacher-x")).toBe("9665222222");
  });

  it("6) database migration: version=3، teacherContacts القديم وteacherContactsByIdentity كلاهما موجودان، البيانات القديمة لم تُحذف", async () => {
    const normalized = normalizeTeacherName("سلمى");
    await directorStore.upsertTeacherContact(normalized, "9665333333");
    await directorStore.upsertTeacherContactByIdentity("teacher-y", "9665444444");

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("khabir-director-local");
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    expect(db.version).toBe(3);
    expect(Array.from(db.objectStoreNames)).toEqual(expect.arrayContaining(["submissions", "teacherContacts", "teacherContactsByIdentity"]));
    db.close();

    // البيانات القديمة سليمة
    expect(await directorStore.getTeacherContact(normalized)).toBe("9665333333");
  });

  it("7) exportBackup/restoreBackup لا تتأثران بالمخزن الجديد — يعملان على submissions فقط كما هما", async () => {
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", completeness, identityFor("teacher-z"));
    await directorStore.upsertTeacherContactByIdentity("teacher-z", "9665555555");

    const backup = await directorStore.exportBackup();
    expect(backup.length).toBe(1);
    expect(backup[0].id).toBe(submission.id);
    // النسخة الاحتياطية لا تحتوي أي حقل متعلق بجهة الاتصال
    expect(JSON.stringify(backup[0])).not.toContain("9665555555");

    await directorStore.restoreBackup(backup);
    const afterRestore = await directorStore.list();
    expect(afterRestore.length).toBe(1);
    // جهة الاتصال بالهوية سليمة بعد الاستعادة (لم تُلمَس أصلًا)
    expect(await directorStore.getTeacherContactByIdentity("teacher-z")).toBe("9665555555");
  });

  it("save(): teacherIdentity صالحة تُخزَّن، فارغة لا تُخزَّن — بلا تغيير في سلوك save() الأساسي", async () => {
    const withIdentity = await directorStore.save(new File(["%PDF"], "a.pdf"), "معلم1", "", completeness, identityFor("teacher-w"));
    expect(withIdentity.teacherId).toBe("teacher-w");
    const withoutIdentity = await directorStore.save(new File(["%PDF"], "b.pdf"), "معلم2", "", null, null);
    expect(withoutIdentity.teacherId).toBeUndefined();
  });
});
