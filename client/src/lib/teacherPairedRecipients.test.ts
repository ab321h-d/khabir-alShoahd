// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDirectorEncryptionKeyFingerprint, generateRecipientId, type DirectorPairingPayloadV1 } from "./directorPairingPayload";
import { pairRecipient, confirmRecipientKeyChange, getPairedRecipient } from "./teacherPairedRecipients";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const DB_NAME = "khabir-teacher-paired-recipients-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

const generateEcdhKeyPair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

const buildPayload = async (recipientId = generateRecipientId(), displayName?: string): Promise<DirectorPairingPayloadV1> => {
  const keyPair = await generateEcdhKeyPair();
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const fingerprint = await computeDirectorEncryptionKeyFingerprint(publicKeyJwk);
  return { schemaVersion: 1, recipientId, directorEncryptionPublicKeyJwk: publicKeyJwk, directorEncryptionKeyFingerprint: fingerprint, createdAt: new Date().toISOString(), ...(displayName ? { displayName } : {}) };
};

describe("PHASE NEXT-2D-C: teacherPairedRecipients — منع استبدال صامت للمفتاح", () => {
  it("13) نفس recipient + نفس مفتاح → idempotent (status: unchanged)", async () => {
    const payload = await buildPayload();
    await pairRecipient(payload);
    const second = await pairRecipient(payload);
    expect(second.status).toBe("unchanged");
  });

  it("14) العملية idempotent لا تُحدِّث displayLabel صامتًا", async () => {
    const payload = await buildPayload(generateRecipientId(), "الاسم الأصلي");
    await pairRecipient(payload);
    const changedLabelOnly = { ...payload, displayName: "اسم مختلف" };
    const outcome = await pairRecipient(changedLabelOnly);
    expect(outcome.status).toBe("unchanged"); // نفس fingerprint → unchanged، صفر تحديث لأي حقل
    const stored = await getPairedRecipient(payload.recipientId);
    expect(stored?.displayLabel).toBe("الاسم الأصلي"); // لم يتغيَّر
  });

  it("15) نفس recipient + مفتاح مختلف → key_change_required (صفر كتابة)", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const second = await buildPayload(first.recipientId); // نفس recipientId، مفتاح جديد تمامًا
    const outcome = await pairRecipient(second);
    expect(outcome.status).toBe("key_change_required");
  });

  it("16) المفتاح لا يتغيَّر فعليًا قبل تأكيد صريح", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const second = await buildPayload(first.recipientId);
    await pairRecipient(second); // key_change_required، لا فعل إضافي
    const stored = await getPairedRecipient(first.recipientId);
    expect(stored?.encryptionKeyFingerprint).toBe(first.directorEncryptionKeyFingerprint); // لا يزال القديم
  });

  it("17) تأكيد صريح دقيق (fingerprint قديم+جديد مطابقَين) يُغيِّر المفتاح فعليًا", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const second = await buildPayload(first.recipientId);
    const result = await confirmRecipientKeyChange(first.recipientId, first.directorEncryptionKeyFingerprint, second.directorEncryptionKeyFingerprint, second);
    expect(result.ok).toBe(true);
    const stored = await getPairedRecipient(first.recipientId);
    expect(stored?.encryptionKeyFingerprint).toBe(second.directorEncryptionKeyFingerprint);
  });

  it("18) تأكيد بـfingerprint قديم غير مطابق (stale) يفشل — منع TOCTOU", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const second = await buildPayload(first.recipientId);
    const result = await confirmRecipientKeyChange(first.recipientId, "wrong-old-fingerprint-value", second.directorEncryptionKeyFingerprint, second);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale_old_fingerprint");
    const stored = await getPairedRecipient(first.recipientId);
    expect(stored?.encryptionKeyFingerprint).toBe(first.directorEncryptionKeyFingerprint); // صفر تغيير
  });

  it("19) تأكيد بـfingerprint جديد غير مطابق للحمولة الفعلية يفشل", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const second = await buildPayload(first.recipientId);
    const result = await confirmRecipientKeyChange(first.recipientId, first.directorEncryptionKeyFingerprint, "wrong-new-fingerprint-value", second);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_new_fingerprint");
  });

  it("20) recipient مختلف + نفس مفتاح → سجلان مستقلان، مسموح", async () => {
    const keyPair = await generateEcdhKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const fingerprint = await computeDirectorEncryptionKeyFingerprint(publicKeyJwk);
    const payloadA: DirectorPairingPayloadV1 = { schemaVersion: 1, recipientId: generateRecipientId(), directorEncryptionPublicKeyJwk: publicKeyJwk, directorEncryptionKeyFingerprint: fingerprint, createdAt: new Date().toISOString() };
    const payloadB: DirectorPairingPayloadV1 = { ...payloadA, recipientId: generateRecipientId() };
    const outcomeA = await pairRecipient(payloadA);
    const outcomeB = await pairRecipient(payloadB);
    expect(outcomeA.status).toBe("paired");
    expect(outcomeB.status).toBe("paired");
  });

  it("21) persistence عبر IndexedDB test implementation (fake-indexeddb) — إعادة استعلام تُعيد نفس السجل", async () => {
    const payload = await buildPayload();
    await pairRecipient(payload);
    const stored = await getPairedRecipient(payload.recipientId);
    expect(stored?.encryptionKeyFingerprint).toBe(payload.directorEncryptionKeyFingerprint);
  });

  it("25) [تكامل] round trip encode/decode ثم pairRecipient ينجح end-to-end", async () => {
    const { encodeDirectorPairingPayload, decodeDirectorPairingPayload } = await import("./directorPairingPayload");
    const payload = await buildPayload();
    const encoded = await encodeDirectorPairingPayload(payload);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeDirectorPairingPayload(encoded.token);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      const outcome = await pairRecipient(decoded.payload);
      expect(outcome.status).toBe("paired");
    }
  });
});

describe("PHASE NEXT-2D-C: فصل تام عن الثقة — فحص بنيوي مباشر على teacherPairedRecipients.ts", () => {
  it("10/11) صفر import فعلي لـdirectorTrustRegistry/senderTrust/resolveSenderTrust، وصفر استخدام فعلي لـschoolId (التعليق التوثيقي لا يُحتسَب)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "teacherPairedRecipients.ts"), "utf-8");
    expect(source).not.toMatch(/^import .*(directorTrustRegistry|senderTrust)/m);
    expect(source).not.toContain("resolveSenderTrust(");
    expect(source).not.toMatch(/schoolId\s*[:?]/);
    expect(source).not.toContain("schoolMembership");
  });
});

describe("PHASE NEXT-2D-C-FIX1: حدود أمنية runtime حقيقية — صفر ثقة بالنوع TypeScript وحده", () => {
  it("A) pairRecipient مباشرة (بلا encode/decode) يرفض fingerprint لا يطابق JWK الفعلي", async () => {
    const keyPairA = await generateEcdhKeyPair();
    const keyPairB = await generateEcdhKeyPair();
    const jwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);
    const jwkB = await crypto.subtle.exportKey("jwk", keyPairB.publicKey);
    const forgedFingerprint = await computeDirectorEncryptionKeyFingerprint(jwkB);
    const forgedPayload = { schemaVersion: 1, recipientId: generateRecipientId(), directorEncryptionPublicKeyJwk: jwkA, directorEncryptionKeyFingerprint: forgedFingerprint, createdAt: new Date().toISOString() };
    const outcome = await pairRecipient(forgedPayload);
    expect(outcome.status).toBe("invalid_payload");
    if (outcome.status === "invalid_payload") expect(outcome.reason).toBe("fingerprint_mismatch");
  });

  it("B) pairRecipient مباشرة يرفض JWK يحمل مادة خاصة (d)", async () => {
    const payload = await buildPayload();
    const withPrivateMaterial = { ...payload, directorEncryptionPublicKeyJwk: { ...payload.directorEncryptionPublicKeyJwk, d: "leaked-private-material" } };
    const outcome = await pairRecipient(withPrivateMaterial);
    expect(outcome.status).toBe("invalid_payload");
    if (outcome.status === "invalid_payload") expect(outcome.reason).toBe("private_key_material_present");
  });

  it("C) pairRecipient مباشرة يرفض إحداثيات EC صالحة الشكل نصيًا لكن غير قابلة للاستيراد فعليًا", async () => {
    const payload = await buildPayload();
    const bogusCoordinate = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const malformed = { ...payload, directorEncryptionPublicKeyJwk: { ...payload.directorEncryptionPublicKeyJwk, x: bogusCoordinate, y: bogusCoordinate }, directorEncryptionKeyFingerprint: "irrelevant-will-fail-before-fingerprint-check" };
    const outcome = await pairRecipient(malformed);
    expect(outcome.status).toBe("invalid_payload");
  });

  it("D) confirmRecipientKeyChange يرفض newPayload.recipientId مختلف عن recipientId المُمرَّر", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const second = await buildPayload();
    const result = await confirmRecipientKeyChange(first.recipientId, first.directorEncryptionKeyFingerprint, second.directorEncryptionKeyFingerprint, second);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("recipient_mismatch");
    const stored = await getPairedRecipient(first.recipientId);
    expect(stored?.encryptionKeyFingerprint).toBe(first.directorEncryptionKeyFingerprint);
  });

  it("E) confirmRecipientKeyChange يرفض JWK لا يطابق fingerprint المذكور حتى لو expectedNewFingerprint يطابق القيمة المُزوَّرة نفسها", async () => {
    const first = await buildPayload();
    await pairRecipient(first);
    const keyPairA = await generateEcdhKeyPair();
    const keyPairB = await generateEcdhKeyPair();
    const jwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);
    const jwkB = await crypto.subtle.exportKey("jwk", keyPairB.publicKey);
    const forgedFingerprint = await computeDirectorEncryptionKeyFingerprint(jwkB);
    const forgedPayload = { schemaVersion: 1, recipientId: first.recipientId, directorEncryptionPublicKeyJwk: jwkA, directorEncryptionKeyFingerprint: forgedFingerprint, createdAt: new Date().toISOString() };
    const result = await confirmRecipientKeyChange(first.recipientId, first.directorEncryptionKeyFingerprint, forgedFingerprint, forgedPayload);
    expect(result.ok).toBe(false);
    const stored = await getPairedRecipient(first.recipientId);
    expect(stored?.encryptionKeyFingerprint).toBe(first.directorEncryptionKeyFingerprint);
  });

  it("G) الذرية: قراءة+كتابة confirmRecipientKeyChange ضمن نفس متغيّر transaction الواحد (فحص بنيوي مباشر)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "teacherPairedRecipients.ts"), "utf-8");
    const confirmFnBody = source.slice(source.indexOf("export const confirmRecipientKeyChange"));
    const transactionCallCount = (confirmFnBody.match(/database\.transaction\(/g) || []).length;
    expect(transactionCallCount).toBe(1);
  });

  it("H) الذرية: قرار+كتابة pairRecipient ضمن نفس متغيّر transaction الواحد (فحص بنيوي مباشر)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "teacherPairedRecipients.ts"), "utf-8");
    const pairFnBody = source.slice(source.indexOf("export const pairRecipient"), source.indexOf("export type ConfirmKeyChangeResult"));
    const transactionCallCount = (pairFnBody.match(/database\.transaction\(/g) || []).length;
    expect(transactionCallCount).toBe(1);
  });
});
