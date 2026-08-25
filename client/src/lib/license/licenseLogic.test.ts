import { beforeAll, describe, expect, it } from "vitest";
import { licenseCryptoInternal } from "./licenseCrypto";
import { computeLicenseStatus, createInitialTrialState, evaluateActivationCode, scopeCoversVariant } from "./licenseLogic";
import type { ActivatedLicenseState, LicensePayload, TrialLicenseState } from "./licenseTypes";

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

const buildCode = async (payload: LicensePayload, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  const payloadPart = licenseCryptoInternal.bytesToBase64Url(payloadBytes);
  const signaturePart = licenseCryptoInternal.bytesToBase64Url(new Uint8Array(signatureBuffer));
  return `${payloadPart}.${signaturePart}`;
};

let keyPair: CryptoKeyPair;
let publicKeyJwk: JsonWebKey;

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
});

describe("تطابق نطاق الترخيص مع نوع التطبيق", () => {
  it("scope=both يغطي كلًا من المعلم والمدير", () => {
    expect(scopeCoversVariant("both", "teacher")).toBe(true);
    expect(scopeCoversVariant("both", "director")).toBe(true);
  });

  it("scope=teacher يغطي المعلم فقط", () => {
    expect(scopeCoversVariant("teacher", "teacher")).toBe(true);
    expect(scopeCoversVariant("teacher", "director")).toBe(false);
  });

  it("scope=director يغطي المدير فقط", () => {
    expect(scopeCoversVariant("director", "director")).toBe(true);
    expect(scopeCoversVariant("director", "teacher")).toBe(false);
  });
});

describe("حالة التجربة المجانية", () => {
  it("تبقى نشطة قبل انقضاء 3 أشهر تقويمية", () => {
    const state: TrialLicenseState = createInitialTrialState("2026-08-24T10:00:00.000Z");
    const status = computeLicenseStatus(state, "2026-11-01T00:00:00.000Z", "teacher");
    expect(status.kind).toBe("trial_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("تصبح منتهية بعد 3 أشهر تقويمية", () => {
    const state: TrialLicenseState = createInitialTrialState("2026-08-24T10:00:00.000Z");
    const status = computeLicenseStatus(state, "2026-11-25T00:00:00.000Z", "director");
    expect(status.kind).toBe("trial_expired");
    expect(status.writesAllowed).toBe(false);
  });
});

describe("حالة الترخيص المفعَّل (مدفوع)", () => {
  const buildActivated = (scope: ActivatedLicenseState["scope"], expiresAt: string): ActivatedLicenseState => ({
    kind: "activated",
    licenseId: "lic-1",
    scope,
    activatedAt: "2026-08-24T00:00:00.000Z",
    expiresAt,
    lastSeenAt: "2026-08-24T00:00:00.000Z",
  });

  it("scope=teacher نشط لتطبيق المعلم، wrong_scope لتطبيق المدير", () => {
    const state = buildActivated("teacher", "2027-08-24T00:00:00.000Z");
    expect(computeLicenseStatus(state, "2026-09-01T00:00:00.000Z", "teacher").kind).toBe("paid_active");
    expect(computeLicenseStatus(state, "2026-09-01T00:00:00.000Z", "director").kind).toBe("wrong_scope");
  });

  it("scope=both نشط لكل من المعلم والمدير", () => {
    const state = buildActivated("both", "2027-08-24T00:00:00.000Z");
    expect(computeLicenseStatus(state, "2026-09-01T00:00:00.000Z", "teacher").kind).toBe("paid_active");
    expect(computeLicenseStatus(state, "2026-09-01T00:00:00.000Z", "director").kind).toBe("paid_active");
  });

  it("ترخيص مدفوع منتهي الصلاحية يمنع الكتابة", () => {
    const state = buildActivated("both", "2026-09-01T00:00:00.000Z");
    const status = computeLicenseStatus(state, "2026-10-01T00:00:00.000Z", "teacher");
    expect(status.kind).toBe("paid_expired");
    expect(status.writesAllowed).toBe(false);
  });
});

describe("تقييم كود التفعيل", () => {
  const now = "2026-08-24T00:00:00.000Z";

  it("يقبل كودًا صالحًا وينتج حالة مفعَّلة صحيحة", async () => {
    const payload: LicensePayload = { v: 1, licenseId: "lic-ok", scope: "both", issuedAt: now, expiresAt: "2027-08-24T00:00:00.000Z" };
    const code = await buildCode(payload, keyPair.privateKey);
    const result = await evaluateActivationCode(code, publicKeyJwk, "teacher", now);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.scope).toBe("both");
  });

  it("يرفض كودًا منتهي الصلاحية حتى لو كان التوقيع صحيحًا", async () => {
    const payload: LicensePayload = { v: 1, licenseId: "lic-expired", scope: "both", issuedAt: "2025-01-01T00:00:00.000Z", expiresAt: "2025-06-01T00:00:00.000Z" };
    const code = await buildCode(payload, keyPair.privateKey);
    const result = await evaluateActivationCode(code, publicKeyJwk, "teacher", now);
    expect(result.ok).toBe(false);
  });

  it("يرفض كودًا غير مخصص لنسخة التطبيق الحالية", async () => {
    const payload: LicensePayload = { v: 1, licenseId: "lic-teacher-only", scope: "teacher", issuedAt: now, expiresAt: "2027-08-24T00:00:00.000Z" };
    const code = await buildCode(payload, keyPair.privateKey);
    const result = await evaluateActivationCode(code, publicKeyJwk, "director", now);
    expect(result.ok).toBe(false);
  });

  it("يرفض كودًا بتوقيع غير صالح", async () => {
    const otherKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    const payload: LicensePayload = { v: 1, licenseId: "lic-bad-sig", scope: "both", issuedAt: now, expiresAt: "2027-08-24T00:00:00.000Z" };
    const code = await buildCode(payload, otherKeyPair.privateKey);
    const result = await evaluateActivationCode(code, publicKeyJwk, "teacher", now);
    expect(result.ok).toBe(false);
  });

  it("يتحقق دون أي اتصال شبكة", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error("لا يجوز استدعاء الشبكة أثناء التحقق من الترخيص"); }) as typeof fetch;
    try {
      const payload: LicensePayload = { v: 1, licenseId: "lic-offline", scope: "both", issuedAt: now, expiresAt: "2027-08-24T00:00:00.000Z" };
      const code = await buildCode(payload, keyPair.privateKey);
      const result = await evaluateActivationCode(code, publicKeyJwk, "teacher", now);
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
