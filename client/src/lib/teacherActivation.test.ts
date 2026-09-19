import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEACHER_ACTIVATION_PUBLIC_KEY_JWK في الإنتاج = null عمدًا (fail-closed،
 * لم يُزوَّد مفتاح إنتاجي بعد). نُموِّه قيمة الوحدة هنا داخل ملف الاختبار
 * فقط، لمفتاح اختباري يُنشأ عشوائيًا وقت التشغيل — صفر تأثير على
 * teacherActivationConfig.ts نفسه، وصفر مفتاح خاص إنتاجي في أي مكان.
 */
const testKeys = await (async () => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { privateKey: keyPair.privateKey, publicJwk };
})();

vi.mock("./teacherActivationConfig", () => ({ TEACHER_ACTIVATION_PUBLIC_KEY_JWK: testKeys.publicJwk }));

const { verifyTeacherActivation, peekActivationScope } = await import("./teacherActivation");
const { identityStore } = await import("./identityStore");

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const sign = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signatureBuffer))}`;
};

const scope = { schoolId: "2002", stage: "middle" as const };
const basePayload = { version: 1 as const, schoolId: "2002", stage: "middle" as const, role: "teacher" as const, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };

const resetIdentityDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase("khabir-identity-local");
  request.onsuccess = () => resolve();
  request.onerror = () => resolve();
  request.onblocked = () => resolve();
});

beforeEach(async () => {
  await resetIdentityDatabase();
});

describe("verifyTeacherActivation — تحقق كامل لبيانات اعتماد تفعيل المعلم", () => {
  it("يقبل بيانات اعتماد صالحة موقَّعة بشكل صحيح", async () => {
    const code = await sign({ ...basePayload, activationId: "act-valid-001" }, testKeys.privateKey);
    const result = await verifyTeacherActivation(code, scope);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.role).toBe("teacher");
  });

  it("يرفض بيانات اعتماد عُدِّل محتواها (schoolId) بعد التوقيع", async () => {
    const signed = await sign({ ...basePayload, activationId: "act-tampered-001" }, testKeys.privateKey);
    const [, signaturePart] = signed.split(".");
    const tampered = { ...basePayload, activationId: "act-tampered-001", schoolId: "9999" };
    const tamperedCode = `${toBase64Url(new TextEncoder().encode(JSON.stringify(tampered)))}.${signaturePart}`;
    const result = await verifyTeacherActivation(tamperedCode, { schoolId: "9999", stage: "middle" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("يرفض بيانات اعتماد منتهية الصلاحية", async () => {
    const code = await sign({ ...basePayload, activationId: "act-expired-001", expiresAt: new Date(Date.now() - 3_600_000).toISOString() }, testKeys.privateKey);
    const result = await verifyTeacherActivation(code, scope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("expired");
  });

  it("يرفض عند عدم تطابق schoolId مع النطاق المُدخَل", async () => {
    const code = await sign({ ...basePayload, activationId: "act-wrongschool-001" }, testKeys.privateKey);
    const result = await verifyTeacherActivation(code, { schoolId: "7777", stage: "middle" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("scope_mismatch");
  });

  it("يرفض عند عدم تطابق stage مع النطاق المُدخَل", async () => {
    const code = await sign({ ...basePayload, activationId: "act-wrongstage-001" }, testKeys.privateKey);
    const result = await verifyTeacherActivation(code, { schoolId: "2002", stage: "secondary" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("scope_mismatch");
  });

  it("يرفض role مختلف عن teacher", async () => {
    const code = await sign({ ...basePayload, activationId: "act-wrongrole-001", role: "director" }, testKeys.privateKey);
    const result = await verifyTeacherActivation(code, scope);
    expect(result.ok).toBe(false);
  });

  it("يرفض إعادة استخدام نفس activationId محليًا بعد استهلاكه (fake-indexeddb)", async () => {
    const code = await sign({ ...basePayload, activationId: "act-replay-001" }, testKeys.privateKey);
    const first = await verifyTeacherActivation(code, scope);
    expect(first.ok).toBe(true);
    if (first.ok) await identityStore.markActivationConsumed(first.payload.activationId);

    const second = await verifyTeacherActivation(code, scope);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("already_consumed");
  });
});

describe("PILOT-50-D2: peekActivationScope — استخراج schoolId/stage الحقيقيَّين من الاعتماد نفسه", () => {
  it("يستخرج schoolId/stage الحقيقيَّين من بيانات اعتماد موقَّعة فعليًا (لا قيمة مُختلَقة)", async () => {
    const code = await sign({ ...basePayload, activationId: "act-peek-001", schoolId: "1450", stage: "elementary" }, testKeys.privateKey);
    const result = peekActivationScope(code);
    expect(result).toEqual({ schoolId: "1450", stage: "elementary" });
  });

  it("القيمة المُستخلَصة تُطابِق ما تتحقق منه verifyTeacherActivation الحقيقية لاحقًا (سلسلة الثقة الكاملة)", async () => {
    const code = await sign({ ...basePayload, activationId: "act-peek-002", schoolId: "1450", stage: "secondary" }, testKeys.privateKey);
    const peeked = peekActivationScope(code);
    expect(peeked).not.toBeNull();
    const verified = await verifyTeacherActivation(code, peeked!);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.schoolId).toBe("1450");
  });

  it("كود مُشوَّه بالكامل -> null، صفر استخراج", () => {
    expect(peekActivationScope("not-even-base64.garbage")).toBeNull();
  });

  it("توقيع مُزوَّر (بمفتاح خاطئ) لا يمنع الاستخراج المعلوماتي البحت — لكن verifyTeacherActivation اللاحقة سترفضه فعليًا", async () => {
    const wrongKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const forgedCode = await sign({ ...basePayload, activationId: "act-peek-forged", schoolId: "9999" }, wrongKeys.privateKey);
    const peeked = peekActivationScope(forgedCode); // الاستخراج نفسه بلا تحقق توقيع، ينجح شكليًا
    expect(peeked).toEqual({ schoolId: "9999", stage: "middle" });
    const verified = await verifyTeacherActivation(forgedCode, peeked!); // لكن التحقق الحقيقي يرفض التوقيع المزوَّر رياضيًا
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error).toBe("invalid_signature");
  });
});
