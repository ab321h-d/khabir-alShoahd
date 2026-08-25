import { beforeAll, describe, expect, it } from "vitest";
import { licenseCryptoInternal, verifyLicenseCode } from "./licenseCrypto";
import type { LicensePayload } from "./licenseTypes";

/**
 * لا يوجد أي مفتاح خاص مخزَّن في هذا المستودع. كل مفاتيح الاختبار هنا تُنشأ
 * عشوائيًا وقت تشغيل الاختبار نفسه عبر Web Crypto، وتُستخدم مرة واحدة فقط
 * داخل هذا الملف، ثم تُهمَل.
 */
const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

const buildCode = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  const payloadPart = licenseCryptoInternal.bytesToBase64Url(payloadBytes);
  const signaturePart = licenseCryptoInternal.bytesToBase64Url(new Uint8Array(signatureBuffer));
  return `${payloadPart}.${signaturePart}`;
};

let keyPairA: CryptoKeyPair;
let keyPairB: CryptoKeyPair;
let publicKeyJwkA: JsonWebKey;

const samplePayload: LicensePayload = {
  v: 1,
  licenseId: "test-license-0001",
  scope: "both",
  issuedAt: "2026-08-24T00:00:00.000Z",
  expiresAt: "2027-08-24T00:00:00.000Z",
};

beforeAll(async () => {
  keyPairA = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  keyPairB = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  publicKeyJwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);
});

describe("التحقق من توقيع كود الترخيص", () => {
  it("يقبل كودًا موقّعًا بشكل صحيح ويعيد المحتوى كما هو", async () => {
    const code = await buildCode(samplePayload, keyPairA.privateKey);
    const result = await verifyLicenseCode(code, publicKeyJwkA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(samplePayload);
  });

  it("يرفض كودًا موقّعًا بمفتاح خاص مختلف عن المفتاح العام المتحقَّق به", async () => {
    const codeSignedByWrongKey = await buildCode(samplePayload, keyPairB.privateKey);
    const result = await verifyLicenseCode(codeSignedByWrongKey, publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("يرفض كودًا صحيحًا عُدِّل محتواه بعد التوقيع", async () => {
    const validCode = await buildCode(samplePayload, keyPairA.privateKey);
    const signaturePart = validCode.split(".")[1];
    const tamperedPayload = { ...samplePayload, scope: "director" as const };
    const tamperedPayloadPart = licenseCryptoInternal.bytesToBase64Url(new TextEncoder().encode(JSON.stringify(tamperedPayload)));
    const tamperedCode = `${tamperedPayloadPart}.${signaturePart}`;

    const result = await verifyLicenseCode(tamperedCode, publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("يرفض كودًا بصيغة غير صحيحة (بلا فاصل)", async () => {
    const result = await verifyLicenseCode("not-a-valid-code", publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("malformed");
  });

  it("يرفض كودًا فارغًا أو Base64 تالفًا", async () => {
    const result = await verifyLicenseCode("###.###", publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("malformed");
  });

  it("يرفض محتوى موقَّعًا بصحة تشفيرية لكن بشكل بيانات غير مكتمل", async () => {
    const incompletePayload = { foo: "bar" };
    const code = await buildCode(incompletePayload, keyPairA.privateKey);
    const result = await verifyLicenseCode(code, publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_payload");
  });
});
