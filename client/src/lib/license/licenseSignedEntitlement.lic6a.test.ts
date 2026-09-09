import { beforeAll, describe, expect, it } from "vitest";
import { licenseCryptoInternal, verifyLicenseCode, verifySignedEntitlementCode } from "./licenseCrypto";
import { computeSignedEntitlementStatus } from "./licenseLogic";
import type { LicensePayload, SignedEntitlementPayload } from "./licenseTypes";

/**
 * PHASE LIC-6A: اختبارات مركَّزة جديدة تمامًا لـ verifySignedEntitlementCode
 * (v:2) وcomputeSignedEntitlementStatus النقية. ملف منفصل تمامًا عن
 * licenseLogic.test.ts/licenseCrypto.test.ts الحاليين — صفر تعديل عليهما،
 * يبقيان كما هما بلا أي تغيير.
 */

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

const buildCode = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  const payloadPart = licenseCryptoInternal.bytesToBase64Url(payloadBytes);
  const signaturePart = licenseCryptoInternal.bytesToBase64Url(new Uint8Array(signatureBuffer));
  return `${payloadPart}.${signaturePart}`;
};

let keyPair: CryptoKeyPair;
let publicKeyJwk: JsonWebKey;
let otherKeyPair: CryptoKeyPair;

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  otherKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
});

const now = "2026-09-09T00:00:00.000Z";
const future = "2027-09-09T00:00:00.000Z";
const past = "2025-09-09T00:00:00.000Z";

const basePayload: SignedEntitlementPayload = {
  v: 2, entitlementId: "ent-1", accountId: "acct-1", kind: "trial", scope: "both", issuedAt: now, expiresAt: future,
};

describe("verifySignedEntitlementCode — v:2", () => {
  it("valid v2 signed trial verifies", async () => {
    const code = await buildCode(basePayload, keyPair.privateKey);
    const result = await verifySignedEntitlementCode(code, publicKeyJwk);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(basePayload);
  });

  it("valid v2 signed paid verifies", async () => {
    const paidPayload: SignedEntitlementPayload = { ...basePayload, entitlementId: "ent-2", kind: "paid" };
    const code = await buildCode(paidPayload, keyPair.privateKey);
    const result = await verifySignedEntitlementCode(code, publicKeyJwk);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.kind).toBe("paid");
  });

  it("tampered accountId invalidates signature", async () => {
    const signed = await buildCode(basePayload, keyPair.privateKey);
    const [, sigPart] = signed.split(".");
    const tampered = { ...basePayload, accountId: "acct-attacker" };
    const tamperedCode = `${licenseCryptoInternal.bytesToBase64Url(new TextEncoder().encode(JSON.stringify(tampered)))}.${sigPart}`;
    const result = await verifySignedEntitlementCode(tamperedCode, publicKeyJwk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("tampered kind invalidates signature", async () => {
    const signed = await buildCode(basePayload, keyPair.privateKey);
    const [, sigPart] = signed.split(".");
    const tampered = { ...basePayload, kind: "paid" };
    const tamperedCode = `${licenseCryptoInternal.bytesToBase64Url(new TextEncoder().encode(JSON.stringify(tampered)))}.${sigPart}`;
    const result = await verifySignedEntitlementCode(tamperedCode, publicKeyJwk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("tampered expiresAt invalidates signature", async () => {
    const signed = await buildCode(basePayload, keyPair.privateKey);
    const [, sigPart] = signed.split(".");
    const tampered = { ...basePayload, expiresAt: future.replace("2027", "2099") };
    const tamperedCode = `${licenseCryptoInternal.bytesToBase64Url(new TextEncoder().encode(JSON.stringify(tampered)))}.${sigPart}`;
    const result = await verifySignedEntitlementCode(tamperedCode, publicKeyJwk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("tampered signature (wrong key) rejected", async () => {
    const code = await buildCode(basePayload, otherKeyPair.privateKey);
    const result = await verifySignedEntitlementCode(code, publicKeyJwk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_signature");
  });

  it("malformed v2 payload rejected (missing accountId)", async () => {
    const { accountId, ...malformed } = basePayload;
    const code = await buildCode(malformed, keyPair.privateKey);
    const result = await verifySignedEntitlementCode(code, publicKeyJwk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid_payload");
  });

  it("unknown payload version rejected", async () => {
    const unknownVersion = { ...basePayload, v: 3 };
    const code = await buildCode(unknownVersion, keyPair.privateKey);
    const result = await verifySignedEntitlementCode(code, publicKeyJwk);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("unknown_version");
  });

  it("legacy v1 LicensePayload code is rejected by v2 verifier (version mismatch, not accidental acceptance)", async () => {
    const v1Payload: LicensePayload = { v: 1, licenseId: "lic-1", scope: "both", issuedAt: now, expiresAt: future };
    const code = await buildCode(v1Payload, keyPair.privateKey);
    const result = await verifySignedEntitlementCode(code, publicKeyJwk);
    expect(result.ok).toBe(false);
  });
});

describe("legacy v1 verifyLicenseCode — لم يتأثر إطلاقًا بإضافة LIC-6A", () => {
  it("existing legacy v1 code still verifies unchanged", async () => {
    const v1Payload: LicensePayload = { v: 1, licenseId: "lic-legacy", scope: "teacher", issuedAt: now, expiresAt: future };
    const code = await buildCode(v1Payload, keyPair.privateKey);
    const result = await verifyLicenseCode(code, publicKeyJwk);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.licenseId).toBe("lic-legacy");
  });
});

describe("computeSignedEntitlementStatus — دالة نقية", () => {
  it("valid trial + correct scope + not expired -> writes allowed", () => {
    const status = computeSignedEntitlementStatus({ ...basePayload, kind: "trial" }, now, now, "teacher");
    expect(status.kind).toBe("trial_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("valid paid + correct scope + not expired -> writes allowed", () => {
    const status = computeSignedEntitlementStatus({ ...basePayload, kind: "paid" }, now, now, "director");
    expect(status.kind).toBe("paid_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("expired verified trial denies writes", () => {
    const expiredPayload = { ...basePayload, kind: "trial" as const, expiresAt: past };
    const status = computeSignedEntitlementStatus(expiredPayload, past, now, "teacher");
    expect(status.kind).toBe("trial_expired");
    expect(status.writesAllowed).toBe(false);
  });

  it("expired verified paid denies writes", () => {
    const expiredPayload = { ...basePayload, kind: "paid" as const, expiresAt: past };
    const status = computeSignedEntitlementStatus(expiredPayload, past, now, "director");
    expect(status.kind).toBe("paid_expired");
    expect(status.writesAllowed).toBe(false);
  });

  it("wrong scope denies writes", () => {
    const teacherOnly = { ...basePayload, scope: "teacher" as const };
    const status = computeSignedEntitlementStatus(teacherOnly, now, now, "director");
    expect(status.kind).toBe("wrong_scope");
    expect(status.writesAllowed).toBe(false);
  });
});
