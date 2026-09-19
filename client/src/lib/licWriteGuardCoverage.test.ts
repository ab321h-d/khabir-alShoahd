import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PHASE LIC-3 FIX: اختبارات مركَّزة لكل حراسة كتابة أُضيفت حديثًا فقط —
 * تُموِّه assertWriteAllowed/assertWriteAllowedSync/isWriteAllowedSync من
 * license/licenseGuard مباشرة (بدلًا من writeGuardCache/licenseLogic
 * الحقيقيَّين، غير المتاحين لي) للتحكم في writesAllowed بدقة تامة، مع رمي
 * الاستثناء الحقيقي عند الرفض في النسخة async — نفس السلوك الفعلي.
 */
class LicenseRestrictedError extends Error {}

let writesAllowed = true;
vi.mock("./license/licenseGuard", () => ({
  assertWriteAllowed: vi.fn(async () => { if (!writesAllowed) throw new LicenseRestrictedError("انتهت صلاحية الترخيص"); }),
  assertWriteAllowedSync: vi.fn(() => { if (!writesAllowed) throw new LicenseRestrictedError("انتهت صلاحية الترخيص"); }),
  isWriteAllowedSync: vi.fn(() => writesAllowed),
}));

(globalThis as unknown as { window: { indexedDB: IDBFactory; localStorage: Storage } }).window = {
  indexedDB: globalThis.indexedDB,
  localStorage: (() => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
      clear: () => { map.clear(); },
      key: () => null, length: 0,
    } as unknown as Storage;
  })(),
};

const { directorStore } = await import("./directorStore");
const { prototypeStore, localImageStore } = await import("./evidenceStore");
const { __setAuthenticatedDirectorTrialForTests, DirectorWriteRestrictedError } = await import("./directorAuth");
const { identityStore } = await import("./identityStore");

const resetDatabases = () => Promise.all(
  ["khabir-director-local", "khabir-alshawahid-local", "khabir-identity-local"].map(
    (name) => new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
    }),
  ),
);

beforeEach(async () => {
  writesAllowed = true;
  await resetDatabases();
  window.localStorage.clear();
  // PHASE PILOT-50-F3.4: directorStore.assertDirectorWriteAllowed لم تعد
  // تعتمد على license/licenseGuard.ts (المُموَّهة أعلاه لـevidenceStore
  // فقط) — تحتاج جلسة مدير trial حقيقية مُصادَق عليها فعليًا.
  await __setAuthenticatedDirectorTrialForTests("director-test-user", "test-school-id");
});

const completeness = { schemaVersion: 1 as const, exportId: "e1", generatedAt: "2026-09-09T00:00:00.000Z", performanceAreas: [], totals: { areasCount: 0, completeCount: 0, needsReviewCount: 0, incompleteCount: 0 } };

describe("directorStore — حراسات LIC-3 الجديدة (PHASE PILOT-50-F3.4: عبر DirectorTrial الحقيقية)", () => {
  const expireTrial = () => identityStore.putDirectorTrial({ userId: "director-test-user", schoolId: "test-school-id", startedAt: "2000-01-01T00:00:00.000Z" });
  const restoreTrial = () => identityStore.putDirectorTrial({ userId: "director-test-user", schoolId: "test-school-id", startedAt: new Date().toISOString() });

  it("remove(): يُرفَض عند trial منتهية، بلا حذف فعلي؛ يُسمَح عند trial نشطة", async () => {
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", completeness, null);
    await expireTrial();
    await expect(directorStore.remove(submission.id)).rejects.toThrow(DirectorWriteRestrictedError);
    await restoreTrial();
    expect((await directorStore.list()).some((item) => item.id === submission.id)).toBe(true);
    await directorStore.remove(submission.id);
    expect((await directorStore.list()).some((item) => item.id === submission.id)).toBe(false);
  });

  it("clearAll(): يُرفَض عند trial منتهية، صفر مسح؛ ينجح عند trial نشطة", async () => {
    await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم", "", completeness, null);
    await expireTrial();
    await expect(directorStore.clearAll()).rejects.toThrow(DirectorWriteRestrictedError);
    expect((await directorStore.list()).length).toBe(1);
    await restoreTrial();
    await directorStore.clearAll();
    expect((await directorStore.list()).length).toBe(0);
  });

  it("restoreBackup(): يُرفَض عند trial منتهية قبل أي مسح/كتابة جزئية؛ ينجح عند trial نشطة", async () => {
    const original = await directorStore.save(new File(["%PDF"], "p.pdf"), "أصلي", "", completeness, null);
    const backup = await directorStore.exportBackup();
    await expireTrial();
    await expect(directorStore.restoreBackup(backup)).rejects.toThrow(DirectorWriteRestrictedError);
    const afterRejected = await directorStore.list();
    expect(afterRejected.length).toBe(1);
    expect(afterRejected[0].id).toBe(original.id);
    await restoreTrial();
    await directorStore.restoreBackup(backup);
    expect((await directorStore.list()).length).toBe(1);
  });
});

describe("evidenceStore.prototypeStore — حراسات LIC-3 الجديدة", () => {
  it("saveAsync(): يُرفَض عند false، صفر كتابة localStorage؛ ينجح عند true", async () => {
    const draft = prototypeStore.load();
    writesAllowed = false;
    await expect(prototypeStore.saveAsync({ ...draft, title: "محظور" })).rejects.toThrow(LicenseRestrictedError);
    expect(window.localStorage.getItem("khabir-alshawahid.prototype.v1")).toBeNull();
    writesAllowed = true;
    await prototypeStore.saveAsync({ ...draft, title: "مسموح" });
    expect(window.localStorage.getItem("khabir-alshawahid.prototype.v1")).toContain("مسموح");
  });

  it("clear(): no-op صامت عند false (بلا استثناء، بلا مسح)؛ يمسح عند true", () => {
    window.localStorage.setItem("khabir-alshawahid.prototype.v1", JSON.stringify({ marker: true }));
    writesAllowed = false;
    expect(() => prototypeStore.clear()).not.toThrow();
    expect(window.localStorage.getItem("khabir-alshawahid.prototype.v1")).not.toBeNull();
    writesAllowed = true;
    prototypeStore.clear();
    expect(window.localStorage.getItem("khabir-alshawahid.prototype.v1")).toBeNull();
  });

  it("clearAll(): يُرفَض عند false، صفر مسح لأي مفتاح؛ ينجح عند true", async () => {
    window.localStorage.setItem("khabir-alshawahid.prototype.v1", JSON.stringify({ marker: true }));
    window.localStorage.setItem("khabir-alshawahid.cover-preset.v1", JSON.stringify({ marker: true }));
    writesAllowed = false;
    await expect(prototypeStore.clearAll()).rejects.toThrow(LicenseRestrictedError);
    expect(window.localStorage.getItem("khabir-alshawahid.prototype.v1")).not.toBeNull();
    expect(window.localStorage.getItem("khabir-alshawahid.cover-preset.v1")).not.toBeNull();
    writesAllowed = true;
    await prototypeStore.clearAll();
    expect(window.localStorage.getItem("khabir-alshawahid.prototype.v1")).toBeNull();
  });

  it("clearEvidenceImages(): يُرفَض عند false، صفر تغيير على المسودة المخزَّنة؛ ينجح عند true", async () => {
    const draft = { ...prototypeStore.load(), bundle: [{ id: "e1" }], captured: true } as unknown as Parameters<typeof prototypeStore.saveAsync>[0];
    writesAllowed = true;
    await prototypeStore.saveAsync(draft);
    writesAllowed = false;
    await expect(prototypeStore.clearEvidenceImages()).rejects.toThrow(LicenseRestrictedError);
    const stillThere = JSON.parse(window.localStorage.getItem("khabir-alshawahid.prototype.v1")!);
    expect(stillThere.captured).toBe(true);
    writesAllowed = true;
    await prototypeStore.clearEvidenceImages();
    const cleared = JSON.parse(window.localStorage.getItem("khabir-alshawahid.prototype.v1")!);
    expect(cleared.captured).toBe(false);
  });
});

describe("evidenceStore.localImageStore — حراسات LIC-3 الجديدة", () => {
  it("deleteEvidenceImages(): يُرفَض عند false، صفر حذف صور؛ ينجح عند true (يحمي deleteCapture/removeEvidence تلقائيًا)", async () => {
    await localImageStore.saveEvidenceImages([new File(["x"], "a.png", { type: "image/png" })], "capture-evidence");
    writesAllowed = false;
    await expect(localImageStore.deleteEvidenceImages("capture-evidence")).rejects.toThrow(LicenseRestrictedError);
    expect((await localImageStore.listEvidenceImages("capture-evidence")).length).toBe(1);
    writesAllowed = true;
    await localImageStore.deleteEvidenceImages("capture-evidence");
    expect((await localImageStore.listEvidenceImages("capture-evidence")).length).toBe(0);
  });

  it("restoreBackupImages(): يُرفَض عند false، صفر كتابة صور؛ ينجح عند true", async () => {
    writesAllowed = false;
    await expect(localImageStore.restoreBackupImages([])).rejects.toThrow(LicenseRestrictedError);
    writesAllowed = true;
    await expect(localImageStore.restoreBackupImages([])).resolves.not.toThrow();
  });
});
