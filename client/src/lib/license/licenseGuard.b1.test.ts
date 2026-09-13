import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedEntitlementPayload } from "./licenseTypes";

(globalThis as unknown as { window: { indexedDB: IDBFactory } }).window = { indexedDB: globalThis.indexedDB };

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let testKeyPair: CryptoKeyPair;
let testPublicJwk: JsonWebKey;
let wrongKeyPair: CryptoKeyPair;

const bytesToBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const buildCode = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(new Uint8Array(sig))}`;
};

vi.mock("./licenseConfig", () => ({ get LICENSE_PUBLIC_KEY_JWK() { return testPublicJwk; } }));

const { licenseStore } = await import("./licenseStore");
const { getCurrentLicenseStatus } = await import("./licenseGuard");
const { isWriteAllowedSync, resetWriteGuardCacheForTests } = await import("./writeGuardCache");

const DB_NAME = "khabir-license-local";
const STORE_NAME = "state";
const recordKeyFor = (variant) => `current:${variant}`;

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const seedRaw = (state: unknown, variant: "teacher" | "director" = "teacher") => new Promise<void>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onupgradeneeded = () => { if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) openRequest.result.createObjectStore(STORE_NAME); };
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const putRequest = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, recordKeyFor(variant));
    putRequest.onsuccess = () => { db.close(); resolve(); };
    putRequest.onerror = () => { db.close(); reject(putRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

beforeEach(async () => {
  await resetDatabase();
  resetWriteGuardCacheForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});

afterEach(async () => { await resetDatabase(); });

describe("LIC-6D-B-3B.3-B1: إغلاق مسار Trial المحلية التلقائية", () => {
  it("1) قاعدة ترخيص فارغة تمامًا -> صفر trial تُنشَأ", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("missing");
    const raw = await licenseStore.readCurrentState("teacher");
    expect(raw).toBeNull(); // صفر أي شيء كُتِب في القاعدة
  });

  it("2) قاعدة فارغة -> writesAllowed=false", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(false);
    expect(isWriteAllowedSync("teacher")).toBe(false);
  });

  it("3) استدعاءات متكررة لبدء التشغيل بقاعدة فارغة -> لا trial تظهر أبدًا", async () => {
    await getCurrentLicenseStatus("teacher");
    await getCurrentLicenseStatus("teacher");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("missing");
    const raw = await licenseStore.readCurrentState("teacher");
    expect(raw).toBeNull();
  });

  it("4) حذف الحالة بعد entitlement نشط -> صفر trial بديلة", async () => {
    const payload: SignedEntitlementPayload = {
      v: 2, entitlementId: "e1", accountId: "a1", kind: "trial", scope: "teacher",
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    };
    const signedCode = await buildCode(payload, testKeyPair.privateKey);
    await licenseStore.saveVerifiedSignedEntitlement(signedCode, new Date().toISOString(), "teacher");
    const activeStatus = await getCurrentLicenseStatus("teacher");
    expect(activeStatus.writesAllowed).toBe(true);

    await resetDatabase(); // محاكاة حذف القاعدة بالكامل من طرف المستخدم/النظام
    const afterDeleteStatus = await getCurrentLicenseStatus("teacher");
    expect(afterDeleteStatus.kind).toBe("missing");
    expect(afterDeleteStatus.writesAllowed).toBe(false);
  });

  it("5) resetLicenseExplicitly -> صفر trial بديلة، الحالة تصبح missing", async () => {
    const result = await licenseStore.resetLicenseExplicitly("teacher");
    expect(result).toBeNull();
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("missing");
    expect(status.writesAllowed).toBe(false);
  });

  it("6) entitlement مُعبَث به (توقيع خاطئ) -> صفر fallback لـtrial", async () => {
    const payload: SignedEntitlementPayload = {
      v: 2, entitlementId: "e2", accountId: "a2", kind: "trial", scope: "teacher",
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    };
    const tamperedSignedCode = await buildCode(payload, wrongKeyPair.privateKey); // مُوقَّع بمفتاح خاطئ
    await seedRaw({ kind: "entitlement", signedCode: tamperedSignedCode, lastSeenAt: new Date().toISOString() });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("invalid"); // فشل تحقق تشفيري صريح، ليس missing وليس trial
    expect(status.writesAllowed).toBe(false);
  });

  it("7) entitlement بنطاق خاطئ (director فقط) لتطبيق teacher -> صفر fallback لـtrial", async () => {
    const payload: SignedEntitlementPayload = {
      v: 2, entitlementId: "e3", accountId: "a3", kind: "paid", scope: "director",
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
    };
    const signedCode = await buildCode(payload, testKeyPair.privateKey);
    await licenseStore.saveVerifiedSignedEntitlement(signedCode, new Date().toISOString(), "teacher");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("wrong_scope");
    expect(status.writesAllowed).toBe(false);
  });

  it("8) entitlement منتهٍ فعليًا -> يبقى منتهيًا، صفر fallback لـtrial", async () => {
    const payload: SignedEntitlementPayload = {
      v: 2, entitlementId: "e4", accountId: "a4", kind: "trial", scope: "teacher",
      issuedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-04-01T00:00:00.000Z",
    };
    const signedCode = await buildCode(payload, testKeyPair.privateKey);
    await licenseStore.saveVerifiedSignedEntitlement(signedCode, new Date().toISOString(), "teacher");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_expired");
    expect(status.writesAllowed).toBe(false);
  });

  it("9) teacher بقاعدة فارغة -> denied", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(false);
    expect(status.kind).toBe("missing");
  });

  it("10) director بقاعدة فارغة -> denied (نفس السياسة)", async () => {
    const status = await getCurrentLicenseStatus("director");
    expect(status.writesAllowed).toBe(false);
    expect(status.kind).toBe("missing");
  });

  it("11) أثناء التنفيذ غير المتزامن (قبل الاكتمال) -> الكاش المتزامن يبقى false", async () => {
    resetWriteGuardCacheForTests();
    const promise = getCurrentLicenseStatus("teacher");
    // قبل اكتمال await: الكاش لم يُحدَّث بعد لأي قيمة true إطلاقًا (fail-closed بنيويًا)
    expect(isWriteAllowedSync("teacher")).toBe(false);
    await promise;
    expect(isWriteAllowedSync("teacher")).toBe(false); // يبقى false لأن الحالة الحقيقية missing
  });

  it("12) استرجاع الحالة الحقيقية بعد missing يُصفِّر أي true قديم (محاكاة cross-tab/reproof)", async () => {
    // حالة أولى نشطة (كأن تبويبًا آخر رأى entitlement صالحًا سابقًا)
    const payload: SignedEntitlementPayload = {
      v: 2, entitlementId: "e5", accountId: "a5", kind: "paid", scope: "teacher",
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
    };
    const signedCode = await buildCode(payload, testKeyPair.privateKey);
    await licenseStore.saveVerifiedSignedEntitlement(signedCode, new Date().toISOString(), "teacher");
    await getCurrentLicenseStatus("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    // الحالة تُحذَف (محاكاة حدث خارجي/تبويب آخر يُصفِّر القاعدة)، ثم إعادة تحقق
    await resetDatabase();
    await getCurrentLicenseStatus("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(false); // صفر true عالق قديم
  });

  it("13) entitlement صالح موجود بالفعل -> السلوك بلا أي تغيير عن السابق", async () => {
    const payload: SignedEntitlementPayload = {
      v: 2, entitlementId: "e6", accountId: "a6", kind: "paid", scope: "teacher",
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
    };
    const signedCode = await buildCode(payload, testKeyPair.privateKey);
    await licenseStore.saveVerifiedSignedEntitlement(signedCode, new Date().toISOString(), "teacher");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("paid_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("14) توافق legacy: سجل trial قديم (kind='trial') لا يزال يعمل بلا تغيير (لم يُكسَر التوافق المُبقى عمدًا)", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_active"); // سلوك legacy المُبقى عمدًا، لا "missing"
    expect(status.writesAllowed).toBe(true);
  });

  it("15) صفر استدعاءات شبكية جديدة — الدالة لا تزال synchronous-DB-only (فحص بنيوي: التوقيع لم يتغيّر لإضافة fetch/network)", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => { fetchCalled = true; return originalFetch ? originalFetch(...args) : Promise.reject(new Error("no fetch")); };
    try {
      await getCurrentLicenseStatus("teacher");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });
});
