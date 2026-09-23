import { describe, expect, it } from "vitest";
import {
  computeDirectorEncryptionKeyFingerprint,
  generateRecipientId,
  encodeDirectorPairingPayload,
  decodeDirectorPairingPayload,
  validateDirectorPairingPayload,
  formatShortFingerprintDisplay,
  type DirectorPairingPayloadV1,
} from "./directorPairingPayload";

const generateEcdhKeyPair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

const buildValidPayload = async (): Promise<DirectorPairingPayloadV1> => {
  const keyPair = await generateEcdhKeyPair();
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const fingerprint = await computeDirectorEncryptionKeyFingerprint(publicKeyJwk);
  return {
    schemaVersion: 1,
    recipientId: generateRecipientId(),
    directorEncryptionPublicKeyJwk: publicKeyJwk,
    directorEncryptionKeyFingerprint: fingerprint,
    createdAt: new Date().toISOString(),
  };
};

const manuallyEncodeUnvalidated = (payload: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

describe("PHASE NEXT-2D-C: directorPairingPayload — أساسيات", () => {
  it("1) recipientId يحمل 128+ بت عشوائية (16 بايت خام قبل base64url)", () => {
    const id = generateRecipientId();
    expect(id.length).toBe(22);
    expect(id).not.toBe(generateRecipientId());
  });

  it("2) recipientId مستقل تمامًا عن fingerprint المفتاح", async () => {
    const payloadA = await buildValidPayload();
    const payloadB = await buildValidPayload();
    expect(payloadA.recipientId).not.toBe(payloadB.recipientId);
  });

  it("3) fingerprint حتمي — نفس المفتاح ينتج نفس القيمة دائمًا", async () => {
    const keyPair = await generateEcdhKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    expect(await computeDirectorEncryptionKeyFingerprint(jwk)).toBe(await computeDirectorEncryptionKeyFingerprint(jwk));
  });

  it("4) fingerprint مستقل عن ترتيب خصائص JWK", async () => {
    const keyPair = await generateEcdhKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const reordered: JsonWebKey = { y: jwk.y, kty: jwk.kty, x: jwk.x, crv: jwk.crv };
    expect(await computeDirectorEncryptionKeyFingerprint(jwk)).toBe(await computeDirectorEncryptionKeyFingerprint(reordered));
  });

  it("5) مفتاح عام مختلف ينتج fingerprint مختلفًا", async () => {
    const keyPairA = await generateEcdhKeyPair();
    const keyPairB = await generateEcdhKeyPair();
    const jwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);
    const jwkB = await crypto.subtle.exportKey("jwk", keyPairB.publicKey);
    expect(await computeDirectorEncryptionKeyFingerprint(jwkA)).not.toBe(await computeDirectorEncryptionKeyFingerprint(jwkB));
  });

  it("E) round trip: encode ثم decode يُعيد نفس الحمولة الجوهرية (JWK مُعاد بناؤه مُطهَّرًا من ext/key_ops الزائدَين — سلوك FIX2 المقصود)", async () => {
    const payload = await buildValidPayload();
    const encoded = await encodeDirectorPairingPayload(payload);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const result = await decodeDirectorPairingPayload(encoded.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.recipientId).toBe(payload.recipientId);
      expect(result.payload.directorEncryptionKeyFingerprint).toBe(payload.directorEncryptionKeyFingerprint);
      expect(result.payload.createdAt).toBe(payload.createdAt);
      expect(result.payload.directorEncryptionPublicKeyJwk).toEqual({ kty: "EC", crv: "P-256", x: payload.directorEncryptionPublicKeyJwk.x, y: payload.directorEncryptionPublicKeyJwk.y });
    }
  });

  it("قصير العرض للمقارنة البصرية فقط — لا يُستخدَم كمعرِّف أمني", () => {
    const display = formatShortFingerprintDisplay("aVeryLongFingerprintValueThatIsBase64UrlEncodedAndLong");
    expect(display.length).toBeLessThan(20);
    expect(display).toContain("-");
  });
});

describe("PHASE NEXT-2D-C-FIX2: encoder fail-closed — encode نفسها ترفض المُدخَل المُشوَّه قبل أي تسلسل", () => {
  it("A) encode يرفض JWK يحمل مادة خاصة (d)", async () => {
    const payload = await buildValidPayload();
    const withPrivateMaterial = { ...payload, directorEncryptionPublicKeyJwk: { ...payload.directorEncryptionPublicKeyJwk, d: "leaked" } };
    const result = await encodeDirectorPairingPayload(withPrivateMaterial);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("private_key_material_present");
  });

  it("B) encode يرفض fingerprint لا يطابق JWK الفعلي (مُزوَّر)", async () => {
    const keyPairA = await generateEcdhKeyPair();
    const keyPairB = await generateEcdhKeyPair();
    const jwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);
    const jwkB = await crypto.subtle.exportKey("jwk", keyPairB.publicKey);
    const forgedFingerprint = await computeDirectorEncryptionKeyFingerprint(jwkB);
    const forgedPayload = { schemaVersion: 1, recipientId: generateRecipientId(), directorEncryptionPublicKeyJwk: jwkA, directorEncryptionKeyFingerprint: forgedFingerprint, createdAt: new Date().toISOString() };
    const result = await encodeDirectorPairingPayload(forgedPayload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fingerprint_mismatch");
  });

  it("C) encode يرفض إحداثيات EC صالحة الشكل نصيًا لكن غير قابلة للاستيراد فعليًا", async () => {
    const payload = await buildValidPayload();
    const bogus = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const malformed = { ...payload, directorEncryptionPublicKeyJwk: { ...payload.directorEncryptionPublicKeyJwk, x: bogus, y: bogus }, directorEncryptionKeyFingerprint: "irrelevant" };
    const result = await encodeDirectorPairingPayload(malformed);
    expect(result.ok).toBe(false);
  });

  it("D) حقل إضافي غير معروف في المُدخَل لا ينجو إلى التسلسل — decode بعد encode يُعيد فقط الحقول المعروفة", async () => {
    const payload = await buildValidPayload();
    const withExtraField = { ...payload, unknownExtraField: "should-not-survive", anotherSecret: { nested: true } };
    const encoded = await encodeDirectorPairingPayload(withExtraField);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const result = await decodeDirectorPairingPayload(encoded.token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).not.toHaveProperty("unknownExtraField");
      expect(result.payload).not.toHaveProperty("anotherSecret");
      expect(Object.keys(result.payload).sort()).toEqual(["createdAt", "directorEncryptionKeyFingerprint", "directorEncryptionPublicKeyJwk", "recipientId", "schemaVersion"]);
    }
  });

  it("schemaVersion غير مدعومة تُرفَض من encode مباشرة", async () => {
    const payload = await buildValidPayload();
    const malformed = { ...payload, schemaVersion: 2 };
    const result = await encodeDirectorPairingPayload(malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_schema");
  });

  it("منحنى غير صالح يُرفَض من encode مباشرة", async () => {
    const payload = await buildValidPayload();
    const invalidCurve = { ...payload, directorEncryptionPublicKeyJwk: { ...payload.directorEncryptionPublicKeyJwk, crv: "P-384" } };
    const result = await encodeDirectorPairingPayload(invalidCurve);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_curve");
  });

  it("createdAt غير صالح يُرفَض من encode مباشرة", async () => {
    const payload = await buildValidPayload();
    const invalid = { ...payload, createdAt: "not-a-date" };
    const result = await encodeDirectorPairingPayload(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_created_at");
  });
});

describe("PHASE NEXT-2D-C-FIX2: decode مستقل — توكن مُشوَّه بُني يدويًا بلا المرور عبر encode المُتحقِّق", () => {
  it("F) decode يرفض إحداثيات EC صالحة الشكل نصيًا لكن غير قابلة للاستيراد فعليًا", async () => {
    const payload = await buildValidPayload();
    const bogus = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const malformed = { ...payload, directorEncryptionPublicKeyJwk: { ...payload.directorEncryptionPublicKeyJwk, x: bogus, y: bogus } };
    const token = manuallyEncodeUnvalidated(malformed); // بناء توكن مباشر، بلا المرور عبر encode المُتحقِّق
    const result = await decodeDirectorPairingPayload(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unimportable_public_key");
  });

  it("حمولة مُشوَّهة (base64url غير صالح) تُرفَض من decode", async () => {
    const result = await decodeDirectorPairingPayload("not-a-valid-base64url-token!!!");
    expect(result.ok).toBe(false);
  });

  it("fingerprint غير مطابق للـJWK المُرفَق يُرفَض من decode (توكن مبني يدويًا)", async () => {
    const payload = await buildValidPayload();
    const tampered = { ...payload, directorEncryptionKeyFingerprint: "forged-fingerprint-value-xxxx" };
    const token = manuallyEncodeUnvalidated(tampered);
    const result = await decodeDirectorPairingPayload(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fingerprint_mismatch");
  });
});

describe("PHASE NEXT-2D-C: validateDirectorPairingPayload — المُدقِّق المشترك مباشرة", () => {
  it("24) الحمولة المُتحقَّق منها تحتوي بيانات عامة فقط — صفر أي مرجع خاص بعد التسلسل", async () => {
    const payload = await buildValidPayload();
    const encoded = await encodeDirectorPairingPayload(payload);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const normalized = encoded.token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "="));
    expect(decoded).not.toContain('"d"');
    expect(decoded).not.toContain("privateKey");
    expect(decoded).not.toContain("CryptoKey");
  });
});

describe("PHASE NEXT-2D-C: فصل تام عن الثقة — فحص بنيوي مباشر على المصدر", () => {
  it("22) صفر import فعلي لـdirectorTrustRegistry/senderTrust/resolveSenderTrust في directorPairingPayload.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorPairingPayload.ts"), "utf-8");
    expect(source).not.toMatch(/^import .*(directorTrustRegistry|senderTrust)/m);
    expect(source).not.toContain("resolveSenderTrust(");
  });

  it("23) صفر استخدام فعلي لـschoolId كسلطة/حقل بيانات في directorPairingPayload.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorPairingPayload.ts"), "utf-8");
    expect(source).not.toMatch(/schoolId\s*[:?]/);
  });
});
