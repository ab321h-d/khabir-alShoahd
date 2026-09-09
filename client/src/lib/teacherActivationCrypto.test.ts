import { beforeAll, describe, expect, it } from "vitest";
import { parseActivationCredential, verifyActivationSignature } from "./teacherActivationCrypto";

/**
 * لا يوجد أي مفتاح خاص مخزَّن في هذا المستودع. كل مفاتيح الاختبار هنا تُنشأ
 * عشوائيًا وقت تشغيل الاختبار نفسه عبر Web Crypto، وتُستخدم مرة واحدة فقط
 * داخل هذا الملف، ثم تُهمَل.
 */
const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const buildCode = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signatureBuffer))}`;
};

let keyPairA: CryptoKeyPair;
let keyPairB: CryptoKeyPair;
let publicKeyJwkA: JsonWebKey;

const samplePayload = {
  version: 1,
  activationId: "test-teacher-activation-0001",
  schoolId: "2002",
  stage: "middle",
  role: "teacher",
  issuedAt: "2026-08-24T00:00:00.000Z",
  expiresAt: "2027-08-24T00:00:00.000Z",
};

beforeAll(async () => {
  keyPairA = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  keyPairB = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  publicKeyJwkA = await crypto.subtle.exportKey("jwk", keyPairA.publicKey);
});

describe("تحقق توقيع بيانات اعتماد تفعيل المعلم", () => {
  it("يقبل كودًا موقّعًا بشكل صحيح ويعيد المحتوى كما هو", async () => {
    const code = await buildCode(samplePayload, keyPairA.privateKey);
    const result = await verifyActivationSignature(code, publicKeyJwkA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.payloadText)).toEqual(samplePayload);
  });

  it("يرفض كودًا موقّعًا بمفتاح خاص مختلف عن المفتاح العام المتحقَّق به", async () => {
    const codeSignedByWrongKey = await buildCode(samplePayload, keyPairB.privateKey);
    const result = await verifyActivationSignature(codeSignedByWrongKey, publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("يرفض كودًا صحيحًا عُدِّل محتواه بعد التوقيع (schoolId تحديدًا)", async () => {
    const validCode = await buildCode(samplePayload, keyPairA.privateKey);
    const signaturePart = validCode.split(".")[1];
    const tamperedPayload = { ...samplePayload, schoolId: "9999" };
    const tamperedPayloadPart = toBase64Url(new TextEncoder().encode(JSON.stringify(tamperedPayload)));
    const tamperedCode = `${tamperedPayloadPart}.${signaturePart}`;

    const result = await verifyActivationSignature(tamperedCode, publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("يرفض كودًا بصيغة غير صحيحة (بلا فاصل)", async () => {
    const result = await verifyActivationSignature("not-a-valid-code", publicKeyJwkA);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("malformed");
  });

  it("يرفض كودًا فارغًا أو Base64 تالفًا", () => {
    expect(parseActivationCredential("")).toBeNull();
    expect(parseActivationCredential("###")).toBeNull();
  });
});
