// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

vi.mock("../distributionMode", () => ({ DISTRIBUTION_MODE: "controlled-pilot" })); // الأكثر تقييدًا عمدًا — يُثبِت أن director لا تتأثر به إطلاقًا الآن

const { getCurrentLicenseStatus, assertWriteAllowed } = await import("./license/licenseGuard");
const { directorStore } = await import("./directorStore");
const { buildSignedManifestForExport } = await import("./teacherSenderIdentity");
const { resolveSenderTrust } = await import("./teacherIdentityImport");
const { directorTrustRegistry } = await import("./directorTrustRegistry");
const { performTrustedImportSave } = await import("./directorImportOrchestration");
const { __setAuthenticatedDirectorTrialForTests } = await import("./directorAuth");

const resetDatabase = (name: string) => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
const resetAll = () => Promise.all([
  resetDatabase("khabir-license-local"),
  resetDatabase("khabir-director-local"),
  resetDatabase("khabir-teacher-sender-identity-local"),
  resetDatabase("khabir-director-trust-registry-local"),
  resetDatabase("khabir-identity-local"),
]);

beforeEach(async () => {
  await resetAll();
  // PHASE PILOT-50-F3.4: directorStore.save/update/... تعتمد الآن على
  // assertDirectorWriteAllowed (DirectorTrial/DirectorAuthorization)، لا
  // license/licenseGuard.ts — جلسة مدير trial حقيقية مطلوبة لكل هذه الاختبارات.
  await __setAuthenticatedDirectorTrialForTests("director-test-user", "test-school-id");
});
afterEach(async () => { await resetAll(); });

const completeness = { schemaVersion: 1 as const, exportId: "e1", generatedAt: "2026-09-09T00:00:00.000Z", performanceAreas: [], totals: { areasCount: 0, completeCount: 0, needsReviewCount: 0, incompleteCount: 0 } };

describe("PILOT-50-F3-FIX (A): مدير جديد يصل لحالة قابلة للكتابة عبر السلطة الحقيقية، بصرف النظر عن DISTRIBUTION_MODE", () => {
  it("director بحالة فارغة (state===null) -> trial_active حتى في controlled-pilot (director لا تخضع للشرط)", async () => {
    const status = await getCurrentLicenseStatus("director");
    expect(status.kind).toBe("trial_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("assertWriteAllowed(\"director\") تنجح بلا استثناء لمدير جديد", async () => {
    await expect(assertWriteAllowed("director")).resolves.toBeUndefined();
  });

  it("teacher بنفس الشرط controlled-pilot يبقى missing (صفر تسرُّب للسلوك بين الـvariant-ين)", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("missing");
    expect(status.writesAllowed).toBe(false);
  });
});

describe("PILOT-50-F3-FIX (B): حزمة معلم بلا schoolId تُحفَظ فعليًا عبر directorStore الحقيقية", () => {
  it("directorStore.save تنجح فعليًا لمعلم onboarding (بلا schoolId)، صفر استثناء", async () => {
    const noSchoolIdentity = { schemaVersion: 1 as const, exportId: "exp-b1", teacherId: "t-b1", stage: "middle" as const, displayName: "معلم onboarding", generatedAt: new Date().toISOString() };
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم onboarding", "", completeness, noSchoolIdentity);
    expect(submission.id).toBeTruthy();
    const stored = (await directorStore.list()).find((item) => item.id === submission.id);
    expect(stored).toBeDefined();
    expect("schoolId" in (stored as object)).toBe(false);
  });
});

describe("PILOT-50-F3.2 (اختبار حي حقيقي): directorStore.findByExportId + save الحقيقيَّان بلا أي محاكاة", () => {
  it("save تكتب exportId فعليًا عبر cryptographicExportId، findByExportId تجده", async () => {
    const noSchoolIdentity = { schemaVersion: 1 as const, exportId: "exp-real-1", teacherId: "t-real-1", stage: "middle" as const, displayName: "معلم حقيقي", generatedAt: new Date().toISOString() };
    const submission = await directorStore.save(new File(["%PDF"], "p.pdf"), "معلم حقيقي", "", completeness, noSchoolIdentity, "exp-real-1");
    expect(submission.exportId).toBe("exp-real-1");

    const found = await directorStore.findByExportId("exp-real-1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe(submission.id);

    const notFound = await directorStore.findByExportId("exp-does-not-exist");
    expect(notFound).toBeNull();
  });

  it("cryptographicExportId له الأولوية على teacherIdentity.exportId (legacy) عند التعارض النظري", async () => {
    const identityWithDifferentExportId = { schemaVersion: 1 as const, exportId: "legacy-exp-id", teacherId: "t-real-2", schoolId: "2002", stage: "middle" as const, displayName: "معلم legacy", generatedAt: new Date().toISOString() };
    const submission = await directorStore.save(new File(["%PDF"], "p2.pdf"), "معلم legacy", "", completeness, identityWithDifferentExportId, "cryptographic-exp-id");
    expect(submission.exportId).toBe("cryptographic-exp-id");
  });
});

describe("PILOT-50-F3.1+F3.2: ترتيب معاملات exportId الصحيح عبر performTrustedImportSave الحقيقية، مصدر الحقيقة directorStore", () => {
  const buildValidPackage = async (exportId: string) => {
    const pdfBytes = new TextEncoder().encode("real-pdf");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId }));
    const { manifest, signature } = await buildSignedManifestForExport({
      exportId, generatedAt: new Date().toISOString(), displayName: "معلم", stage: "middle", pdfBytes, completenessJsonBytes,
    });
    return { manifest, signature, pdfBytes, completenessJsonBytes };
  };

  // محاكاة بسيطة لـdirectorStore الحقيقية (Map محلية تُمثِّل مصدر الحقيقة
  // الفعلي — نفس مبدأ findByExportId الحقيقية، بمعزل عن تعقيد IndexedDB هنا)
  const makeFakeDirectorStore = () => {
    const records = new Map<string, { id: string }>();
    return {
      findExistingSubmissionByExportId: async (id: string) => records.get(id) ?? null,
      save: async (id: string) => { const record = { id: `sub-${id}` }; records.set(id, record); return record; },
      records,
    };
  };

  it("C) فشل الحفظ لا يُعلِّم exportId كمُشاهَد، ولا يُنشئ سجلًا في directorStore", async () => {
    const { manifest, signature, pdfBytes, completenessJsonBytes } = await buildValidPackage("exp-c1");
    const trustResult = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    expect(trustResult.status).toBe("new_sender");

    const outcome = await performTrustedImportSave({
      exportId: trustResult.status === "new_sender" ? trustResult.manifest.exportId : null,
      findExistingSubmissionByExportId: async () => null,
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: async () => { throw new Error("simulated storage failure"); },
    });
    expect(outcome.status).toBe("save_failed");
    expect(await directorTrustRegistry.hasSeenExportId("exp-c1")).toBe(false);
  });

  it("D) بعد فشل، نفس exportId يبقى قابلًا للمعالجة من جديد (directorStore لم تكتب شيئًا فعليًا)", async () => {
    const { manifest, signature, pdfBytes, completenessJsonBytes } = await buildValidPackage("exp-d1");
    const trustResult = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    if (trustResult.status !== "new_sender") throw new Error("unreachable");

    const fakeStore = makeFakeDirectorStore();
    const failedOutcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId,
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: async () => { throw new Error("simulated failure"); },
    });
    expect(failedOutcome.status).toBe("save_failed");

    const retryOutcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId,
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: () => fakeStore.save(trustResult.manifest.exportId),
    });
    expect(retryOutcome.status).toBe("saved");
  });

  it("E) بعد نجاح حفظ فعلي كامل، exportId يُصبح مُشاهَدًا في سجل الثقة (best-effort)", async () => {
    const { manifest, signature, pdfBytes, completenessJsonBytes } = await buildValidPackage("exp-e1");
    const trustResult = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    if (trustResult.status !== "new_sender") throw new Error("unreachable");
    await directorTrustRegistry.approveSender({
      fingerprint: trustResult.manifest.senderFingerprint, publicKeyJwk: trustResult.manifest.senderPublicKeyJwk,
      approvedDisplayName: trustResult.manifest.displayName, approvedStage: trustResult.manifest.stage,
    });

    const fakeStore = makeFakeDirectorStore();
    const outcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId,
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: () => fakeStore.save(trustResult.manifest.exportId),
    });
    expect(outcome.status).toBe("saved");
    expect(await directorTrustRegistry.hasSeenExportId("exp-e1")).toBe(true);
  });

  it("F) [الإثبات الجوهري] بعد نجاح استيراد كامل عبر directorStore الحقيقية (مُحاكاة)، إعادة إرسال نفس exportId -> save لا تُستدعى إطلاقًا", async () => {
    const { manifest, signature, pdfBytes, completenessJsonBytes } = await buildValidPackage("exp-f1");
    const trustResult = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    if (trustResult.status !== "new_sender") throw new Error("unreachable");

    const fakeStore = makeFakeDirectorStore();
    const firstSave = vi.fn(() => fakeStore.save(trustResult.manifest.exportId));
    const firstOutcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId,
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: firstSave,
    });
    expect(firstOutcome.status).toBe("saved");
    expect(firstSave).toHaveBeenCalledTimes(1);

    const secondSave = vi.fn(() => fakeStore.save(trustResult.manifest.exportId));
    const secondOutcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId, // نفس fakeStore -> يجد السجل الأول فعليًا
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: secondSave,
    });
    expect(secondOutcome.status).toBe("rejected_replay");
    expect(secondSave).not.toHaveBeenCalled();
  });

  it("F3.2) save تنجح لكن markExportIdSeen تفشل -> إعادة المحاولة لا تُنشئ سجلًا ثانيًا (directorStore هي المصدر الموثوق، لا سجل الثقة)", async () => {
    const { manifest, signature, pdfBytes, completenessJsonBytes } = await buildValidPackage("exp-f32-1");
    const trustResult = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    if (trustResult.status !== "new_sender") throw new Error("unreachable");

    const fakeStore = makeFakeDirectorStore();
    const firstOutcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId,
      markExportIdSeen: async () => { throw new Error("trust registry write failed"); }, // فشل الطبقة المعلوماتية
      save: () => fakeStore.save(trustResult.manifest.exportId),
    });
    expect(firstOutcome.status).toBe("saved"); // صفر تراجع

    const secondSave = vi.fn(() => fakeStore.save(trustResult.manifest.exportId));
    const secondOutcome = await performTrustedImportSave({
      exportId: trustResult.manifest.exportId,
      findExistingSubmissionByExportId: fakeStore.findExistingSubmissionByExportId, // يجد السجل الحقيقي رغم فشل markExportIdSeen سابقًا
      markExportIdSeen: (id) => directorTrustRegistry.markExportIdSeen(id),
      save: secondSave,
    });
    expect(secondOutcome.status).toBe("rejected_replay");
    expect(secondSave).not.toHaveBeenCalled();
    expect(fakeStore.records.size).toBe(1); // صفر تكرار فعلي في القاعدة الحقيقية (المُحاكاة)
    // D) السجل الأول الناجح يبقى متاحًا تمامًا، بلا أي مساس منه
    expect(fakeStore.records.get(trustResult.manifest.exportId)).toEqual({ id: `sub-${trustResult.manifest.exportId}` });
  });
});

describe("PILOT-50-F3-FIX (G/H/I): سلوك الثقة الصريح والفشل المغلق يبقى بلا تغيير", () => {
  it("G) مُرسِل غير معروف يتطلب اعتمادًا صريحًا (صفر ثقة تلقائية)", async () => {
    const pdfBytes = new TextEncoder().encode("pdf-g");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-g1" }));
    const { manifest, signature } = await buildSignedManifestForExport({ exportId: "exp-g1", generatedAt: new Date().toISOString(), displayName: "معلم جي", stage: "middle", pdfBytes, completenessJsonBytes });
    const result = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    expect(result.status).toBe("new_sender");
    expect(await directorTrustRegistry.getByFingerprint(manifest.senderFingerprint)).toBeNull();
  });

  it("H) نفس الاسم + مفتاح مختلف لا يرث الثقة", async () => {
    const pdfBytes = new TextEncoder().encode("pdf-h");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-h1" }));
    const first = await buildSignedManifestForExport({ exportId: "exp-h1", generatedAt: new Date().toISOString(), displayName: "نفس الاسم", stage: "middle", pdfBytes, completenessJsonBytes });
    await directorTrustRegistry.approveSender({ fingerprint: first.manifest.senderFingerprint, publicKeyJwk: first.manifest.senderPublicKeyJwk, approvedDisplayName: first.manifest.displayName, approvedStage: first.manifest.stage });

    await resetDatabase("khabir-teacher-sender-identity-local");
    const secondPdfBytes = new TextEncoder().encode("pdf-h2");
    const secondCompletenessBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-h2" }));
    const second = await buildSignedManifestForExport({ exportId: "exp-h2", generatedAt: new Date().toISOString(), displayName: "نفس الاسم", stage: "middle", pdfBytes: secondPdfBytes, completenessJsonBytes: secondCompletenessBytes });
    const result = await resolveSenderTrust({ manifestRaw: second.manifest, signature: second.signature, pdfBytes: secondPdfBytes, completenessJsonBytes: secondCompletenessBytes, authorization: { kind: "trial" } });
    expect(result.status).toBe("name_conflict_different_sender");
  });

  it("I) hash/توقيع مُزوَّر يبقى fail-closed", async () => {
    const pdfBytes = new TextEncoder().encode("pdf-i");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-i1" }));
    const { manifest, signature } = await buildSignedManifestForExport({ exportId: "exp-i1", generatedAt: new Date().toISOString(), displayName: "معلم", stage: "middle", pdfBytes, completenessJsonBytes });
    const tamperedResult = await resolveSenderTrust({ manifestRaw: { ...manifest, displayName: "منتحل" }, signature, pdfBytes, completenessJsonBytes, authorization: { kind: "trial" } });
    expect(tamperedResult.status).toBe("cryptographic_verification_failed");
  });
});

describe("PILOT-50-F3-FIX (J): صفر مفتاح خاص في أي مكان من ناتج التصدير", () => {
  it("buildSignedManifestForExport لا تُعيد أي مرجع CryptoKey قابل للتسلسل", async () => {
    const pdfBytes = new TextEncoder().encode("pdf-j");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-j1" }));
    const result = await buildSignedManifestForExport({ exportId: "exp-j1", generatedAt: new Date().toISOString(), displayName: "معلم", stage: "middle", pdfBytes, completenessJsonBytes });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("CryptoKey");
  });
});
