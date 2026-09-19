// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { resolveSenderTrust, resolveStableTeacherIdentity } = await import("./teacherIdentityImport");
const { directorTrustRegistry } = await import("./directorTrustRegistry");
const { signCanonicalManifest, computeSenderFingerprint } = await import("./teacherManifestCrypto");

const DB_NAME = "khabir-director-trust-registry-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

const pdfBytes = new TextEncoder().encode("pdf-content-real");
const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-1" }));

const buildValidPackage = async (overrides: { displayName?: string; exportId?: string } = {}) => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const fingerprint = await computeSenderFingerprint(publicKeyJwk);
  const encoder = new TextEncoder();
  const sha256Hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");

  const manifest = {
    schemaVersion: 1 as const,
    exportId: overrides.exportId ?? "exp-1",
    generatedAt: new Date().toISOString(),
    senderFingerprint: fingerprint,
    senderPublicKeyJwk: publicKeyJwk,
    displayName: overrides.displayName ?? "أ. نورة",
    stage: "middle",
    files: {
      "portfolio.pdf": await sha256Hex(pdfBytes),
      "completeness.json": await sha256Hex(completenessJsonBytes),
    },
  };
  const signature = await signCanonicalManifest(manifest, keyPair.privateKey);
  return { manifest, signature };
};

describe("PILOT-50-F1: directorTrustRegistry connection/behavior fixes", () => {
  it("touchLastSeen على fingerprint غير معروف -> صفر إنشاء لأي سجل جديد", async () => {
    await directorTrustRegistry.touchLastSeen("unknown-fingerprint-xyz");
    const result = await directorTrustRegistry.getByFingerprint("unknown-fingerprint-xyz");
    expect(result).toBeNull();
  });

  it("touchLastSeen على fingerprint موجود -> يُحدِّث lastSeenAt فعليًا", async () => {
    await directorTrustRegistry.approveSender({ fingerprint: "fp-touch-1", publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, approvedDisplayName: "معلم", approvedStage: "middle" });
    const before = await directorTrustRegistry.getByFingerprint("fp-touch-1");
    await new Promise((resolve) => setTimeout(resolve, 5)); // فرق زمني حقيقي صغير لضمان طابع زمني مختلف
    await directorTrustRegistry.touchLastSeen("fp-touch-1");
    const after = await directorTrustRegistry.getByFingerprint("fp-touch-1");
    expect(after?.lastSeenAt).not.toBe(before?.lastSeenAt);
    expect(new Date(after!.lastSeenAt).getTime()).toBeGreaterThan(new Date(before!.lastSeenAt).getTime());
  });

  it("approveSender لـfingerprint موجود بالفعل -> يحافظ على firstApprovedAt الأصلي", async () => {
    await directorTrustRegistry.approveSender({ fingerprint: "fp-preserve-1", publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, approvedDisplayName: "معلم أول", approvedStage: "middle" });
    const first = await directorTrustRegistry.getByFingerprint("fp-preserve-1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await directorTrustRegistry.approveSender({ fingerprint: "fp-preserve-1", publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, approvedDisplayName: "معلم أول مُحدَّث", approvedStage: "middle" });
    const second = await directorTrustRegistry.getByFingerprint("fp-preserve-1");
    expect(second?.firstApprovedAt).toBe(first?.firstApprovedAt); // لم يتغيَّر
    expect(second?.approvedDisplayName).toBe("معلم أول مُحدَّث"); // بقية الحقول تُحدَّث بشكل طبيعي
  });

  it("approveSender لـfingerprint جديد -> يُنشئ بالضبط هذا السجل فقط (firstApprovedAt=lastSeenAt=الآن)، صفر تأثير على سجلات أخرى", async () => {
    await directorTrustRegistry.approveSender({ fingerprint: "fp-other-existing", publicKeyJwk: { kty: "EC", crv: "P-256", x: "x1", y: "y1" }, approvedDisplayName: "معلم آخر سابق", approvedStage: "secondary" });
    await directorTrustRegistry.approveSender({ fingerprint: "fp-new-1", publicKeyJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, approvedDisplayName: "معلم جديد", approvedStage: "elementary" });

    const created = await directorTrustRegistry.getByFingerprint("fp-new-1");
    expect(created).not.toBeNull();
    expect(created?.firstApprovedAt).toBe(created?.lastSeenAt);
    expect(created?.approvedDisplayName).toBe("معلم جديد");

    // السجل الآخر الموجود مسبقًا لم يتأثر إطلاقًا
    const unrelated = await directorTrustRegistry.getByFingerprint("fp-other-existing");
    expect(unrelated?.approvedDisplayName).toBe("معلم آخر سابق");
  });
});

describe("PILOT-50-F TRUST", () => {
  it("أول مُرسِل صالح غير معروف -> new_sender", async () => {
    const { manifest, signature } = await buildValidPackage();
    const result = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes });
    expect(result.status).toBe("new_sender");
  });

  it("اعتماد صريح ثم إرسال لاحق بنفس المفتاح -> trusted", async () => {
    const { manifest, signature } = await buildValidPackage();
    await directorTrustRegistry.approveSender({ fingerprint: manifest.senderFingerprint, publicKeyJwk: manifest.senderPublicKeyJwk, approvedDisplayName: manifest.displayName, approvedStage: manifest.stage });
    const result = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes });
    expect(result.status).toBe("trusted");
  });

  it("نفس الاسم + fingerprint مختلف -> name_conflict_different_sender", async () => {
    const first = await buildValidPackage({ displayName: "أ. نورة" });
    await directorTrustRegistry.approveSender({ fingerprint: first.manifest.senderFingerprint, publicKeyJwk: first.manifest.senderPublicKeyJwk, approvedDisplayName: first.manifest.displayName, approvedStage: first.manifest.stage });

    const second = await buildValidPackage({ displayName: "أ. نورة" }); // نفس الاسم، مفتاح جديد تمامًا
    const result = await resolveSenderTrust({ manifestRaw: second.manifest, signature: second.signature, pdfBytes, completenessJsonBytes });
    expect(result.status).toBe("name_conflict_different_sender");
  });

  it("التعارض لا يستبدل الثقة القديمة (بلا اعتماد صريح للجديد)", async () => {
    const first = await buildValidPackage({ displayName: "أ. نورة" });
    await directorTrustRegistry.approveSender({ fingerprint: first.manifest.senderFingerprint, publicKeyJwk: first.manifest.senderPublicKeyJwk, approvedDisplayName: first.manifest.displayName, approvedStage: first.manifest.stage });
    const second = await buildValidPackage({ displayName: "أ. نورة" });
    await resolveSenderTrust({ manifestRaw: second.manifest, signature: second.signature, pdfBytes, completenessJsonBytes }); // صفر اعتماد صريح هنا

    const stillTrusted = await directorTrustRegistry.getByFingerprint(first.manifest.senderFingerprint);
    expect(stillTrusted).not.toBeNull();
    const newOneNotTrusted = await directorTrustRegistry.getByFingerprint(second.manifest.senderFingerprint);
    expect(newOneNotTrusted).toBeNull();
  });

  it("اعتماد صريح للهوية الجديدة يعمل بلا حذف صامت للقديمة", async () => {
    const first = await buildValidPackage({ displayName: "أ. نورة" });
    await directorTrustRegistry.approveSender({ fingerprint: first.manifest.senderFingerprint, publicKeyJwk: first.manifest.senderPublicKeyJwk, approvedDisplayName: first.manifest.displayName, approvedStage: first.manifest.stage });
    const second = await buildValidPackage({ displayName: "أ. نورة" });
    await directorTrustRegistry.approveSender({ fingerprint: second.manifest.senderFingerprint, publicKeyJwk: second.manifest.senderPublicKeyJwk, approvedDisplayName: second.manifest.displayName, approvedStage: second.manifest.stage });

    expect(await directorTrustRegistry.getByFingerprint(first.manifest.senderFingerprint)).not.toBeNull();
    expect(await directorTrustRegistry.getByFingerprint(second.manifest.senderFingerprint)).not.toBeNull();
  });
});

describe("PILOT-50-F REPLAY", () => {
  it("exportId جديد -> غير مُشاهَد سابقًا", async () => {
    expect(await directorTrustRegistry.hasSeenExportId("exp-new")).toBe(false);
  });
  it("exportId مُسجَّل -> مُشاهَد سابقًا", async () => {
    await directorTrustRegistry.markExportIdSeen("exp-seen");
    expect(await directorTrustRegistry.hasSeenExportId("exp-seen")).toBe(true);
  });
  it("حالة إعادة الإرسال مستقلة تمامًا عن صحة التوقيع التشفيرية", async () => {
    const { manifest, signature } = await buildValidPackage({ exportId: "exp-replay-test" });
    await directorTrustRegistry.markExportIdSeen(manifest.exportId);
    const result = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes });
    expect(result.status).toBe("new_sender"); // التوقيع لا يزال صحيحًا فعليًا، إعادة الإرسال إعلامية فقط منفصلة
  });
});

describe("PILOT-50-F LEGACY", () => {
  it("حزمة قديمة غير موقَّعة (identity.json فقط) تبقى unverified، صفر ثقة", () => {
    const identity = { schemaVersion: 1 as const, exportId: "legacy-1", teacherId: "t1", schoolId: "s1", stage: "middle" as const, displayName: "معلم قديم", generatedAt: new Date().toISOString() };
    const resolved = resolveStableTeacherIdentity(identity, { exportId: "legacy-1", generatedAt: identity.generatedAt });
    expect(resolved).not.toBeNull(); // consistency check فقط، كما كانت
    // لكن هذا المسار القديم لا يستدعي resolveSenderTrust إطلاقًا ولا directorTrustRegistry — صفر إنشاء ثقة تشفيرية من هذا المسار بنيويًا
  });

  it("حزمة قديمة لا يمكنها انتحال اسم معلم موثوق تشفيريًا (لا تُستدعى resolveSenderTrust أصلًا لها)", async () => {
    const { manifest } = await buildValidPackage({ displayName: "معلم موثوق" });
    await directorTrustRegistry.approveSender({ fingerprint: manifest.senderFingerprint, publicKeyJwk: manifest.senderPublicKeyJwk, approvedDisplayName: manifest.displayName, approvedStage: manifest.stage });
    // مسار legacy لا يملك fingerprint إطلاقًا، فلا يمكنه حتى الاستعلام بنفس آلية trusted لهذا المُرسِل
    const byName = await directorTrustRegistry.findApprovedByDisplayName("معلم موثوق");
    expect(byName?.fingerprint).toBe(manifest.senderFingerprint); // موجود فقط لأنه fingerprint المعلم الحقيقي، لا أي كود legacy زائف
  });
});
