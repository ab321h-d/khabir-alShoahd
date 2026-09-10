import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedEntitlementPayload } from "./licenseTypes";

(globalThis as unknown as { window: { indexedDB: IDBFactory } }).window = { indexedDB: globalThis.indexedDB };

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let testKeyPair: CryptoKeyPair;
let testPublicJwk: JsonWebKey;

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
const RECORD_KEY = "current";

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const seedRaw = (state: unknown) => new Promise<void>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onupgradeneeded = () => { if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) openRequest.result.createObjectStore(STORE_NAME); };
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const putRequest = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, RECORD_KEY);
    putRequest.onsuccess = () => { db.close(); resolve(); };
    putRequest.onerror = () => { db.close(); reject(putRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

const readRaw = () => new Promise<any>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const getRequest = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(RECORD_KEY);
    getRequest.onsuccess = () => { db.close(); resolve(getRequest.result); };
    getRequest.onerror = () => { db.close(); reject(getRequest.error); };
  };
});

beforeEach(async () => {
  await resetDatabase();
  resetWriteGuardCacheForTests();
});

const future = "2027-09-09T00:00:00.000Z";
const past = "2025-09-09T00:00:00.000Z";
const basePayload: SignedEntitlementPayload = { v: 2, entitlementId: "ent-1", accountId: "acct-1", kind: "trial", scope: "both", issuedAt: "2026-09-09T00:00:00.000Z", expiresAt: future };

describe("licenseGuard — LIC-6B", () => {
  beforeEach(async () => {
    testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
  });

  it("cache false قبل أي await (فحص فوري أثناء الاستدعاء)", async () => {
    const promise = getCurrentLicenseStatus("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    await promise;
  });

  it("valid persisted v2 trial reverified على القراءة", async () => {
    const code = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_active");
    expect(status.writesAllowed).toBe(true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("valid persisted v2 paid reverified", async () => {
    const paid = { ...basePayload, kind: "paid" as const };
    const code = await buildCode(paid, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("director");
    expect(status.kind).toBe("paid_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("tampered signedCode denied, بلا تجربة جديدة", async () => {
    await seedRaw({ kind: "entitlement", signedCode: "not-valid-code", lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("invalid");
    expect(status.writesAllowed).toBe(false);
    const raw = await readRaw();
    expect(raw.kind).toBe("entitlement");
  });

  it("invalid signature (مفتاح خاطئ) denied", async () => {
    const wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    const code = await buildCode(basePayload, wrongKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("invalid");
    expect(status.writesAllowed).toBe(false);
  });

  it("malformed v2 payload denied", async () => {
    const { accountId, ...malformed } = basePayload as any;
    const code = await buildCode(malformed, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("invalid");
  });

  it("unknown version denied", async () => {
    const unknownVersion = { ...basePayload, v: 3 };
    const code = await buildCode(unknownVersion, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("invalid");
  });

  it("wrong scope denied (توقيع صحيح)", async () => {
    const teacherOnly = { ...basePayload, scope: "teacher" as const };
    const code = await buildCode(teacherOnly, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("director");
    expect(status.kind).toBe("wrong_scope");
    expect(status.writesAllowed).toBe(false);
  });

  it("expired trial denied", async () => {
    const expired = { ...basePayload, expiresAt: past };
    const code = await buildCode(expired, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_expired");
    expect(status.writesAllowed).toBe(false);
  });

  it("expired paid denied", async () => {
    const expired = { ...basePayload, kind: "paid" as const, expiresAt: past };
    const code = await buildCode(expired, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("director");
    expect(status.kind).toBe("paid_expired");
  });

  it("invalid entitlement لا يُهيِّئ تجربة محلية جديدة إطلاقًا", async () => {
    await seedRaw({ kind: "entitlement", signedCode: "garbage", lastSeenAt: "2026-09-09T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    expect(raw.kind).toBe("entitlement");
    expect(raw).not.toHaveProperty("trialStartedAt");
  });

  it("crypto-invalid لا يُحدِّث lastSeenAt إطلاقًا", async () => {
    await seedRaw({ kind: "entitlement", signedCode: "garbage", lastSeenAt: "2026-01-01T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    expect(raw.lastSeenAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("verified wrong_scope يُحدِّث lastSeenAt فعليًا", async () => {
    const teacherOnly = { ...basePayload, scope: "teacher" as const };
    const code = await buildCode(teacherOnly, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2020-01-01T00:00:00.000Z" });
    await getCurrentLicenseStatus("director");
    const raw = await readRaw();
    expect(raw.lastSeenAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("verified expired يُحدِّث lastSeenAt فعليًا", async () => {
    const expired = { ...basePayload, expiresAt: past };
    const code = await buildCode(expired, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2020-01-01T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    expect(raw.lastSeenAt).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("نجاح entitlement صالح يُعيد الكاش true", async () => {
    const code = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("signedCode يبقى بلا تغيير بعد touchLastSeen", async () => {
    const code = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2020-01-01T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    expect(raw.signedCode).toBe(code);
  });

  it("lastSeenAt رتيبة: لا تتراجع حتى مع وقت مستقبلي مصطنع مُخزَّن مسبقًا", async () => {
    const code = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2099-01-01T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    expect(raw.lastSeenAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("PHASE LIC-6B-FIX2: نتيجة قديمة (طلب أقدم اكتمل متأخرًا) تُعيد الحالة الحقيقية المحسوبة (لا invalid مصطنعة) — كاش الكتابة وحده يعكس الأحدث", async () => {
    const validCode = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: validCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });

    const promiseA = getCurrentLicenseStatus("teacher");
    const statusB = await getCurrentLicenseStatus("teacher");
    const statusA = await promiseA;

    // A تُعيد نتيجتها الحقيقية بالضبط، لا "invalid" مصطنعة لمجرد وجود B
    expect(statusA.kind).toBe("trial_active");
    expect(statusA.writesAllowed).toBe(true);
    expect(statusB.kind).toBe("trial_active");
    // الكاش يعكس B (الأحدث في تسلسل العدَّاد) — وهنا يتطابقان لأن البيانات نفسها لم تتغيّر
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("PHASE LIC-6B-FIX2: assertWriteAllowed لطلب قديم (نتيجته true) يرمي فعليًا لو الكاش الأحدث false (كلا الشرطين مطلوبان)", async () => {
    const { assertWriteAllowed, LicenseRestrictedError } = await import("./licenseGuard");
    const validCode = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: validCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });

    const staleAssertPromise = assertWriteAllowed("teacher"); // A: سيحسب true من البيانات الحالية
    staleAssertPromise.catch(() => {});

    // قبل اكتمال A، تصبح البيانات منتهية فعليًا، وB الأحدث يقرأها ويُحدِّث الكاش إلى false
    const expiredCode = await buildCode({ ...basePayload, expiresAt: past }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: expiredCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher"); // B: أحدث، يُحدِّث الكاش إلى false

    // A تُكمَل الآن — status.writesAllowed لها الخاص قد يكون true (من البيانات وقت قراءتها)،
    // لكن isWriteAllowedSync الحالية false — الشرط المزدوج يرفض
    await expect(staleAssertPromise).rejects.toBeInstanceOf(LicenseRestrictedError);
  });

  it("PHASE LIC-6B-FIX2: طلب أحدث مرفوض + طلب أقدم مسموح يكتمل لاحقًا -> الكتابة المحمية تُرفَض، لكن status A الحقيقي يبقى صحيحًا لعرض الواجهة", async () => {
    const validCode = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: validCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const promiseA = getCurrentLicenseStatus("teacher"); // A: سيحسب صالحًا (true)

    const expiredCode = await buildCode({ ...basePayload, expiresAt: past }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: expiredCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const statusB = await getCurrentLicenseStatus("teacher"); // B: أحدث، يحسب منتهي (false)
    expect(statusB.writesAllowed).toBe(false);

    const statusA = await promiseA;
    // status A الحقيقي (للعرض) يبقى "trial_active"/true — لم يُزيَّف
    expect(statusA.kind).toBe("trial_active");
    expect(statusA.writesAllowed).toBe(true);
    // لكن الكاش (المصدر الوحيد لتفويض الكتابة الفعلي) يعكس B الأحدث: false
    expect(isWriteAllowedSync("teacher")).toBe(false);
  });

  it("PHASE LIC-6B-FIX2: مختلَط — LicenseContext.refresh وassertWriteAllowed مباشر متزامنان: الكتابة تُرفَض دائمًا وفق أحدث كاش، بصرف النظر عن أي status قديم", async () => {
    const { assertWriteAllowed } = await import("./licenseGuard");
    const validCode = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: validCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });

    // طلب "سياق" A يبدأ (يُحاكي LicenseContext.refresh استدعاء getCurrentLicenseStatus مباشرة)
    const contextPromiseA = getCurrentLicenseStatus("teacher");
    // طلب "كتابة مباشرة" B يبدأ لاحقًا، بعد تغيير البيانات إلى منتهية
    const expiredCode = await buildCode({ ...basePayload, expiresAt: past }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: expiredCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    await expect(assertWriteAllowed("teacher")).rejects.toThrow(); // B: يُرفَض بحق (منتهية فعليًا)

    const contextStatusA = await contextPromiseA;
    // النتيجة المعروضة لـ"السياق" تبقى حقيقية (trial_active من وقت قراءتها)، بلا تزييف
    expect(contextStatusA.kind).toBe("trial_active");
  });

  it("PHASE LIC-6B-FIX: entitlement.touchLastSeen يحافظ على signedCode حرفيًا بعد readCurrentState/getOrInitializeState معًا", async () => {
    const code = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2020-01-01T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    expect(raw.signedCode).toBe(code);
    expect(raw.kind).toBe("entitlement");
  });

  it("PHASE LIC-6B-FIX: وجود entitlement (حتى لو صالحًا) لا يمكن أن يصل إطلاقًا لمسار تهيئة تجربة جديدة", async () => {
    const code = await buildCode(basePayload, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    await getCurrentLicenseStatus("teacher");
    const raw = await readRaw();
    // صفر أي حقل خاص بـ TrialLicenseState ظهر خطأً فوق سجل entitlement
    expect(raw).not.toHaveProperty("trialStartedAt");
    expect(raw.kind).toBe("entitlement");
  });
});
