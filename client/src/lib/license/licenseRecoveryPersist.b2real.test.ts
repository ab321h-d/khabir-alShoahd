// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PHASE PILOT-50-D: هذه الاختبارات تفحص سلوك public-trial تحديدًا (بدء trial تلقائي)
vi.mock("../distributionMode", () => ({ DISTRIBUTION_MODE: "public-trial" }));
import type { SignedEntitlementPayload } from "./licenseTypes";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

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
const { persistRecoveredSignedEntitlement, enrollSignedEntitlement } = await import("./licenseEnrollment");
const { isWriteAllowedSync, resetWriteGuardCacheForTests } = await import("./writeGuardCache");

const DB_NAME = "khabir-license-local";
const STORE_NAME = "state";
const recordKeyFor = (variant: "teacher" | "director") => `current:${variant}`;

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

const readRaw = (variant: "teacher" | "director" = "teacher") => new Promise<any>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const getRequest = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(recordKeyFor(variant));
    getRequest.onsuccess = () => { db.close(); resolve(getRequest.result); };
    getRequest.onerror = () => { db.close(); reject(getRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

const future = new Date(Date.now() + 365 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const now = new Date().toISOString();

const activeTrial: SignedEntitlementPayload = { v: 2, entitlementId: "r1", accountId: "acc1", kind: "trial", scope: "teacher", issuedAt: now, expiresAt: future };
const activePaid: SignedEntitlementPayload = { v: 2, entitlementId: "r2", accountId: "acc1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future };

beforeEach(async () => {
  await resetDatabase();
  resetWriteGuardCacheForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});

afterEach(async () => { await resetDatabase(); });

describe("LIC-6D-B-3B.3-B2-REAL: persistRecoveredSignedEntitlement", () => {
  it("1) missing + valid active teacher -> persisted, active", async () => {
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success_active");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(true);
  });

  it("2) missing + valid active director -> persisted, active", async () => {
    const payload = { ...activeTrial, scope: "director" as const };
    const code = await buildCode(payload, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "director");
    expect(result.status).toBe("success_active");
  });

  it("3) missing + valid expired correct scope -> persisted, expired, writes=false", async () => {
    const expiredPayload = { ...activeTrial, expiresAt: past };
    const code = await buildCode(expiredPayload, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success_expired");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(false);
    expect(status.kind).toBe("trial_expired");
  });

  it("4) [PILOT-50-B: تطور عقد] tampered code -> rejected, لكن reproof يبدأ trial جديدة عبر Blocker 1 (لا null دائم)", async () => {
    const code = await buildCode(activeTrial, wrongKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(result.status).toBe("invalid");
    const after = await licenseStore.readCurrentState("teacher");
    expect(after).not.toBeNull();
    expect((after as { kind: string }).kind).toBe("trial");
  });

  it("5) malformed code -> rejected", async () => {
    const result = await persistRecoveredSignedEntitlement("not-a-valid-code", "teacher");
    expect(result.status).toBe("invalid");
  });

  it("6) teacher app + director code -> wrong scope rejected", async () => {
    const payload = { ...activeTrial, scope: "director" as const };
    const code = await buildCode(payload, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(result.status).toBe("wrong_scope");
  });

  it("7) director app + teacher code -> wrong scope rejected", async () => {
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "director");
    expect(result.status).toBe("wrong_scope");
  });

  it("8) [PILOT-50-B: تطور عقد] فشل الاسترداد اليدوي لا يمنع بدء trial تلقائية عبر Blocker 1", async () => {
    await persistRecoveredSignedEntitlement("garbage", "teacher");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_active");
    const raw = await licenseStore.readCurrentState("teacher");
    expect((raw as { kind: string }).kind).toBe("trial");
  });

  it("9) استرداد منتهٍ لا يُنشئ/يُمدِّد trial أبدًا", async () => {
    const expiredPayload = { ...activeTrial, expiresAt: past };
    const code = await buildCode(expiredPayload, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(code, "teacher");
    const raw = await licenseStore.readCurrentState("teacher");
    expect(raw?.kind).toBe("entitlement");
  });

  it("10) استرداد منتهٍ لا يُفعِّل الكتابة أبدًا", async () => {
    const expiredPayload = { ...activeTrial, expiresAt: past };
    const code = await buildCode(expiredPayload, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(code, "teacher");
    expect(isWriteAllowedSync("teacher")).toBe(false);
  });

  it("11) entitlement نشطة مسترَدة تُفعِّل الكتابة فقط بعد reproof مركزي", async () => {
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success_active");
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("12) الحفظ يُخزِّن raw signedCode فقط، لا بيانات وصفية من المستدعي", async () => {
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(code, "teacher");
    const raw = await readRaw("teacher");
    expect(raw.kind).toBe("entitlement");
    expect(raw.signedCode).toBe(code.trim());
    expect(Object.keys(raw).sort()).toEqual(["kind", "lastSeenAt", "signedCode"].sort());
  });

  it("13) lastSeenAt رتيب: استرداد لاحق لا يُرجِع الوقت للخلف", async () => {
    const laterLastSeen = new Date(Date.now() + 10000).toISOString();
    const code1 = await buildCode(activeTrial, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(code1, "teacher");
    await licenseStore.touchLastSeen("teacher", laterLastSeen);

    const code2 = await buildCode({ ...activePaid, entitlementId: "r-newer" }, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(code2, "teacher");

    const raw = await readRaw("teacher");
    expect(new Date(raw.lastSeenAt).getTime()).toBeGreaterThanOrEqual(new Date(laterLastSeen).getTime());
  });

  it("14) paid نشطة محليًا لا تُنزَّل بـtrial مسترَدة", async () => {
    const paidCode = await buildCode(activePaid, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(paidCode, "teacher");
    const before = await readRaw("teacher");

    const trialCode = await buildCode({ ...activeTrial, entitlementId: "weaker-trial" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(trialCode, "teacher");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("teacher");
    expect(after.signedCode).toBe(before.signedCode);
  });

  it("15) حق نشط لا يُدمَّر بمسترَد منتهٍ (حتى لو paid)", async () => {
    const activeCode = await buildCode(activeTrial, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(activeCode, "teacher");
    const before = await readRaw("teacher");

    const expiredPaidCode = await buildCode({ ...activePaid, expiresAt: past }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(expiredPaidCode, "teacher");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("teacher");
    expect(after.signedCode).toBe(before.signedCode);
  });

  it("16) استرداد مرفوض يحافظ على جوهر الحالة المحلية السابقة (signedCode/kind)", async () => {
    const paidCode = await buildCode(activePaid, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(paidCode, "teacher");
    const before = await readRaw("teacher");
    await persistRecoveredSignedEntitlement("garbage-tampered", "teacher");
    const after = await readRaw("teacher");
    expect(after.signedCode).toBe(before.signedCode);
    expect(after.kind).toBe(before.kind);
    expect(new Date(after.lastSeenAt).getTime()).toBeGreaterThanOrEqual(new Date(before.lastSeenAt).getTime());
  });

  it("17) الاسترداد غير المتزامن يبدأ fail-closed فورًا (قبل الاكتمال)", async () => {
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    const promise = persistRecoveredSignedEntitlement(code, "teacher");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    await promise;
  });

  it("18) [PILOT-50-B: تطور عقد] reproof بعد حذف القاعدة بالكامل يبدأ trial جديدة عبر Blocker 1 (لا false دائم)، صفر true عالق من الحالة السابقة تحديدًا", async () => {
    const paidCode = await buildCode(activePaid, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(paidCode, "teacher");
    expect(isWriteAllowedSync("teacher")).toBe(true);
    const rawBefore = await licenseStore.readCurrentState("teacher");
    await resetDatabase();
    await getCurrentLicenseStatus("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(true); // true جديد شرعي (trial جديدة)، لا "عالق" من paidCode المحذوفة
    const rawAfter = await licenseStore.readCurrentState("teacher");
    expect((rawAfter as { kind: string }).kind).toBe("trial");
    expect(rawAfter).not.toEqual(rawBefore); // صفر بقايا من الحالة السابقة المحذوفة
  });

  it("19) [PILOT-50-B: تطور عقد] Blocker 1 محفوظة: قاعدة فارغة تبدأ trial تلقائيًا بلا أي استدعاء استرداد يدوي", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_active");
    const raw = await licenseStore.readCurrentState("teacher");
    expect((raw as { kind: string }).kind).toBe("trial");
  });

  it("20) [PILOT-50-B: تطور عقد] enrollSignedEntitlement العادية لا تزال ترفض كودًا منتهيًا (صفر إضعاف على منطق الرفض نفسه)، لكن reproof يبدأ trial عبر Blocker 1", async () => {
    const expiredPayload = { ...activeTrial, expiresAt: past };
    const code = await buildCode(expiredPayload, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("expired"); // منطق الرفض نفسه بلا أي إضعاف
    const after = await licenseStore.readCurrentState("teacher");
    expect((after as { kind: string }).kind).toBe("trial"); // trial جديدة، لا الكود المنتهي المرفوض
  });

  it("21) مصفوفة استبدال enrollment العادية سليمة (صفر إضعاف)", async () => {
    const paidCode = await buildCode(activePaid, testKeyPair.privateKey);
    await enrollSignedEntitlement(paidCode, "teacher");
    const trialCode = await buildCode({ ...activeTrial, entitlementId: "manual-trial" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(trialCode, "teacher");
    expect(result.status).toBe("downgrade_rejected");
  });

  it("22) صفر استدعاءات شبكية جديدة", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (...args: Parameters<typeof fetch>) => { fetchCalled = true; return originalFetch ? originalFetch(...args) : Promise.reject(new Error("no fetch")); };
    try {
      const code = await buildCode(activeTrial, testKeyPair.privateKey);
      await persistRecoveredSignedEntitlement(code, "teacher");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });

  it("23) عزل teacher/director: استرداد teacher لا يؤثر على خانة director المنفصلة إطلاقًا", async () => {
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(code, "teacher");
    const directorStatus = await getCurrentLicenseStatus("director");
    // PILOT-50-B: director تبدأ trial جديدة خاصة بها عبر Blocker 1 (لا missing)
    // — الجوهر (عزل عن خانة teacher) لا يزال قائمًا: صفر تأثر بمحتوى استرداد teacher
    expect(directorStatus.kind).toBe("trial_active");
    expect(directorStatus.writesAllowed).toBe(true);
    const teacherStatus = await getCurrentLicenseStatus("teacher");
    expect(teacherStatus.writesAllowed).toBe(true);
  });

  it("24) حالة محلية تالفة + استرداد صالح -> يُستبدَل", async () => {
    await seedRaw({ kind: "entitlement", signedCode: "definitely-not-a-valid-signed-code", lastSeenAt: now }, "teacher");
    const code = await buildCode(activeTrial, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success_active");
  });

  it("25) إعادة استرداد نفس signedCode الكنسي مرتين -> حتمي/متكافئ الفاعلية", async () => {
    const code = await buildCode(activePaid, testKeyPair.privateKey);
    const first = await persistRecoveredSignedEntitlement(code, "teacher");
    const second = await persistRecoveredSignedEntitlement(code, "teacher");
    expect(first.status).toBe("success_active");
    expect(second.status).toBe("success_active");
    const raw = await readRaw("teacher");
    expect(raw.signedCode).toBe(code.trim());
  });

  // ===== مصفوفة legacy الكاملة (G-N، من تصحيحات B2 السابقة المُثبَتة) =====

  it("A) director + legacy director نشط + استرداد director منتهٍ -> replacement_denied", async () => {
    await seedRaw({ kind: "activated", licenseId: "legacy-director", scope: "director", activatedAt: now, expiresAt: future, lastSeenAt: now }, "director");
    const before = await readRaw("director");
    const expiredDirectorCode = await buildCode({ ...activeTrial, scope: "director" as const, expiresAt: past }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(expiredDirectorCode, "director");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("director");
    expect(after.kind).toBe(before.kind);
    expect(after.licenseId).toBe(before.licenseId);
  });

  it("B) teacher + legacy teacher نشط + استرداد teacher منتهٍ -> replacement_denied", async () => {
    await seedRaw({ kind: "activated", licenseId: "legacy-teacher", scope: "teacher", activatedAt: now, expiresAt: future, lastSeenAt: now }, "teacher");
    const before = await readRaw("teacher");
    const expiredTeacherCode = await buildCode({ ...activeTrial, expiresAt: past }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(expiredTeacherCode, "teacher");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("teacher");
    expect(after.kind).toBe(before.kind);
    expect(after.licenseId).toBe(before.licenseId);
  });

  it("C) director app + existing نشط signed teacher PAID + استرداد director TRIAL نشطة -> مسموح", async () => {
    const teacherPaidCode = await buildCode(activePaid, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: teacherPaidCode, lastSeenAt: now }, "teacher");
    const directorTrialCode = await buildCode({ ...activeTrial, scope: "director" as const, entitlementId: "director-trial" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(directorTrialCode, "director");
    expect(result.status).toBe("success_active");
    const raw = await readRaw("director");
    expect(raw.signedCode).toBe(directorTrialCode.trim());
    const teacherRaw = await readRaw("teacher");
    expect(teacherRaw.signedCode).toBe(teacherPaidCode.trim());
  });

  it("D) teacher app + existing نشط signed director PAID + استرداد teacher TRIAL نشطة -> مسموح", async () => {
    const directorPaidCode = await buildCode({ ...activePaid, scope: "director" as const }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: directorPaidCode, lastSeenAt: now }, "director");
    const teacherTrialCode = await buildCode({ ...activeTrial, entitlementId: "teacher-trial" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(teacherTrialCode, "teacher");
    expect(result.status).toBe("success_active");
    const directorRaw = await readRaw("director");
    expect(directorRaw.signedCode).toBe(directorPaidCode.trim());
  });

  it("E) نطاق حالي نشط paid signed + استرداد trial لنفس النطاق -> replacement_denied", async () => {
    const paidCode = await buildCode(activePaid, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(paidCode, "teacher");
    const before = await readRaw("teacher");
    const trialCode = await buildCode({ ...activeTrial, entitlementId: "weaker" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(trialCode, "teacher");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("teacher");
    expect(after.signedCode).toBe(before.signedCode);
  });

  it("F) حق نطاق حالي نشط + استرداد منتهٍ لنفس النطاق -> replacement_denied", async () => {
    const activeCode = await buildCode(activeTrial, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(activeCode, "teacher");
    const before = await readRaw("teacher");
    const expiredCode = await buildCode({ ...activeTrial, expiresAt: past, entitlementId: "expired-attempt" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(expiredCode, "teacher");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("teacher");
    expect(after.signedCode).toBe(before.signedCode);
  });

  it("G) legacy paid نشطة teacher + استرداد teacher trial نشطة -> replacement_denied، legacy محفوظة", async () => {
    await seedRaw({ kind: "activated", licenseId: "legacy-paid-teacher", scope: "teacher", activatedAt: now, expiresAt: future, lastSeenAt: now }, "teacher");
    const before = await readRaw("teacher");
    const trialCode = await buildCode(activeTrial, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(trialCode, "teacher");
    expect(result.status).toBe("replacement_denied");
    const after = await readRaw("teacher");
    expect(after.kind).toBe("activated");
    expect(after.licenseId).toBe(before.licenseId);
  });

  it("H) legacy paid نشطة director + استرداد director trial نشطة -> replacement_denied", async () => {
    await seedRaw({ kind: "activated", licenseId: "legacy-paid-director", scope: "director", activatedAt: now, expiresAt: future, lastSeenAt: now }, "director");
    const directorTrialCode = await buildCode({ ...activeTrial, scope: "director" as const }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(directorTrialCode, "director");
    expect(result.status).toBe("replacement_denied");
  });

  it("I) legacy paid نشطة تنتهي لاحقًا + استرداد paid ينتهي أبكر -> replacement_denied", async () => {
    const legacyExpiry = new Date(Date.now() + 2 * 365 * 86400000).toISOString();
    await seedRaw({ kind: "activated", licenseId: "legacy-long", scope: "teacher", activatedAt: now, expiresAt: legacyExpiry, lastSeenAt: now }, "teacher");
    const shorterPaidCode = await buildCode(activePaid, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(shorterPaidCode, "teacher");
    expect(result.status).toBe("replacement_denied");
  });

  it("J) legacy paid نشطة + استرداد paid بنفس المدة أو أطول -> allowed", async () => {
    const legacyExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
    await seedRaw({ kind: "activated", licenseId: "legacy-short", scope: "teacher", activatedAt: now, expiresAt: legacyExpiry, lastSeenAt: now }, "teacher");
    const longerPaidCode = await buildCode(activePaid, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(longerPaidCode, "teacher");
    expect(result.status).toBe("success_active");
  });

  it("K) legacy trial نشطة تنتهي لاحقًا + استرداد trial ينتهي أبكر -> replacement_denied", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: now, lastSeenAt: now }, "teacher");
    const shorterTrialCode = await buildCode({ ...activeTrial, expiresAt: new Date(Date.now() + 10 * 86400000).toISOString() }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(shorterTrialCode, "teacher");
    expect(result.status).toBe("replacement_denied");
  });

  it("L) legacy trial نشطة + استرداد trial بنفس المدة أو أطول -> allowed", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: now, lastSeenAt: now }, "teacher");
    const longerTrialCode = await buildCode({ ...activeTrial, expiresAt: future }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(longerTrialCode, "teacher");
    expect(result.status).toBe("success_active");
  });

  it("M) legacy trial نشطة + استرداد paid نشطة -> allowed (ترقية شرعية)", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: now, lastSeenAt: now }, "teacher");
    const paidCode = await buildCode(activePaid, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(paidCode, "teacher");
    expect(result.status).toBe("success_active");
  });

  it("N) legacy بنطاق خاطئ (يبدو نشطًا لكن لنطاق مختلف) + استرداد صحيح النطاق -> allowed", async () => {
    await seedRaw({ kind: "activated", licenseId: "legacy-wrong-scope", scope: "director", activatedAt: now, expiresAt: future, lastSeenAt: now }, "teacher");
    const teacherTrialCode = await buildCode(activeTrial, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(teacherTrialCode, "teacher");
    expect(result.status).toBe("success_active");
  });

  it("O) proof مُزوَّر لا ينطبق هنا (B2-REAL لا proof) — بدلًا: verifier تشفيري مُزوَّر بالكامل يُرفَض قبل أي حفظ", async () => {
    const payload = { ...activeTrial } as SignedEntitlementPayload;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const realSig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, testKeyPair.privateKey, payloadBytes as BufferSource);
    const tamperedSig = new Uint8Array(realSig);
    tamperedSig[0] ^= 0xff; // قلب بايت واحد من التوقيع نفسه
    const tamperedCode = `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(tamperedSig)}`;
    const result = await persistRecoveredSignedEntitlement(tamperedCode, "teacher");
    expect(result.status).toBe("invalid");
    const after = await licenseStore.readCurrentState("teacher");
    expect((after as { kind: string }).kind).toBe("trial"); // PILOT-50-B: reproof يبدأ trial عبر Blocker 1 بدل null دائم
  });

  // ===== TEST COMPLETION: الحالات المطلوبة صراحة (1-6) =====

  it("P1) فشل الحفظ (persistence failure): current صالح + saveVerifiedSignedEntitlement تفشل -> persistence_error، صفر تغيير، writes تعكس الحالة القديمة بعد reproof", async () => {
    const existingCode = await buildCode(activePaid, testKeyPair.privateKey);
    await persistRecoveredSignedEntitlement(existingCode, "teacher");
    const before = await readRaw("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    const saveSpy = vi.spyOn(licenseStore, "saveVerifiedSignedEntitlement").mockRejectedValueOnce(new Error("simulated storage failure"));
    const newCode = await buildCode({ ...activePaid, entitlementId: "should-not-persist" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(newCode, "teacher");
    saveSpy.mockRestore();

    expect(result.status).toBe("persistence_error");
    const after = await readRaw("teacher");
    expect(after.signedCode).toBe(before.signedCode); // صفر تغيير على signedCode
    expect(after.kind).toBe(before.kind);
    // fail() تستدعي getCurrentLicenseStatus داخليًا -> reproof يقرأ الحالة
    // القديمة الصالحة نفسها (لم تُكتَب المحاولة الفاشلة) -> writes=true
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("P2) تزامن حقيقي لطلبَي استرداد لنفس الـvariant -> تسلسل صحيح، صفر كسر لمصفوفة الاستبدال، صفر hold عالق", async () => {
    const shortCode = await buildCode({ ...activePaid, entitlementId: "p2-short", expiresAt: new Date(Date.now() + 30 * 86400000).toISOString() }, testKeyPair.privateKey);
    const longCode = await buildCode({ ...activePaid, entitlementId: "p2-long", expiresAt: future }, testKeyPair.privateKey);

    // كلاهما يبدآن متزامنَين حقيقيًا (Promise.all)، القفل التسلسلي لكل
    // variant يحسم الترتيب الفعلي داخليًا
    const [resultA, resultB] = await Promise.all([
      persistRecoveredSignedEntitlement(shortCode, "teacher"),
      persistRecoveredSignedEntitlement(longCode, "teacher"),
    ]);

    // النتيجة النهائية يجب أن تكون متسقة مع مصفوفة الاستبدال دائمًا: مهما
    // كان ترتيب التنفيذ الفعلي، signedCode النهائي المخزَّن يجب أن يكون
    // الأطول مدة (longCode) — إذ لو نُفِّذ shortCode أولًا فقط لينجح، فإن
    // longCode اللاحق (أطول مدة) سيُسمَح له دائمًا (allow: longer replaces
    // shorter)؛ ولو نُفِّذ longCode أولًا، shortCode اللاحق سيُرفَض (deny:
    // shorter cannot replace longer) — في كلتا الحالتين، الفائز النهائي
    // الوحيد الممكن هو longCode.
    const finalRaw = await readRaw("teacher");
    expect(finalRaw.signedCode).toBe(longCode.trim());
    expect([resultA.status, resultB.status]).toContain("success_active");

    // صفر hold عالق بعد اكتمال كلا الطلبين
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("P3) recovery وenrollSignedEntitlement متزامنان لنفس الـvariant -> نفس القفل/الطابور، نتيجة نهائية متسقة مع ترتيب القفل، صفر تجاوز للسياسة", async () => {
    const recoveryCode = await buildCode({ ...activePaid, entitlementId: "p3-recovery", expiresAt: future }, testKeyPair.privateKey);
    const enrollCode = await buildCode({ ...activeTrial, entitlementId: "p3-enroll" }, testKeyPair.privateKey); // trial أضعف من paid

    const [recoveryResult, enrollResult] = await Promise.all([
      persistRecoveredSignedEntitlement(recoveryCode, "teacher"),
      enrollSignedEntitlement(enrollCode, "teacher"),
    ]);

    // بصرف النظر عن ترتيب التنفيذ الفعلي: لو recovery (paid) نُفِّذت أولًا،
    // enroll (trial) اللاحقة تُرفَض (paid->trial ممنوع G) -> recovery فائزة.
    // لو enroll (trial) نُفِّذت أولًا (missing->trial allow)، recovery
    // (paid) اللاحقة تُسمَح دائمًا (trial->paid allow D) -> recovery فائزة
    // أيضًا. في كلتا الحالتين recoveryCode هو المخزَّن النهائي دائمًا.
    const finalRaw = await readRaw("teacher");
    expect(finalRaw.signedCode).toBe(recoveryCode.trim());
    expect([recoveryResult.status, enrollResult.status]).toContain("success_active");

    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("P4-a) signed trial->trial: مدة أقصر -> deny", async () => {
    await persistRecoveredSignedEntitlement(await buildCode(activeTrial, testKeyPair.privateKey), "teacher");
    const before = await readRaw("teacher");
    const shorterTrial = await buildCode({ ...activeTrial, entitlementId: "p4a-shorter", expiresAt: new Date(Date.now() + 10 * 86400000).toISOString() }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(shorterTrial, "teacher");
    expect(result.status).toBe("replacement_denied");
    expect((await readRaw("teacher")).signedCode).toBe(before.signedCode);
  });

  it("P4-b) signed trial->trial: نفس المدة بالضبط (equal) -> allow", async () => {
    await persistRecoveredSignedEntitlement(await buildCode(activeTrial, testKeyPair.privateKey), "teacher");
    const equalTrial = await buildCode({ ...activeTrial, entitlementId: "p4b-equal" }, testKeyPair.privateKey); // نفس expiresAt=future تمامًا
    const result = await persistRecoveredSignedEntitlement(equalTrial, "teacher");
    expect(result.status).toBe("success_active");
    expect((await readRaw("teacher")).signedCode).toBe(equalTrial.trim());
  });

  it("P4-c) signed trial->trial: مدة أطول/أحدث -> allow", async () => {
    await persistRecoveredSignedEntitlement(await buildCode(activeTrial, testKeyPair.privateKey), "teacher");
    const longerTrial = await buildCode({ ...activeTrial, entitlementId: "p4c-longer", expiresAt: new Date(Date.now() + 400 * 86400000).toISOString() }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(longerTrial, "teacher");
    expect(result.status).toBe("success_active");
    expect((await readRaw("teacher")).signedCode).toBe(longerTrial.trim());
  });

  it("P5-a) signed paid->paid: مدة أقصر -> deny", async () => {
    await persistRecoveredSignedEntitlement(await buildCode(activePaid, testKeyPair.privateKey), "teacher");
    const before = await readRaw("teacher");
    const shorterPaid = await buildCode({ ...activePaid, entitlementId: "p5a-shorter", expiresAt: new Date(Date.now() + 10 * 86400000).toISOString() }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(shorterPaid, "teacher");
    expect(result.status).toBe("replacement_denied");
    expect((await readRaw("teacher")).signedCode).toBe(before.signedCode);
  });

  it("P5-b) signed paid->paid: نفس المدة بالضبط (equal) -> allow", async () => {
    await persistRecoveredSignedEntitlement(await buildCode(activePaid, testKeyPair.privateKey), "teacher");
    const equalPaid = await buildCode({ ...activePaid, entitlementId: "p5b-equal" }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(equalPaid, "teacher");
    expect(result.status).toBe("success_active");
    expect((await readRaw("teacher")).signedCode).toBe(equalPaid.trim());
  });

  it("P5-c) signed paid->paid: مدة أطول/أحدث -> allow", async () => {
    await persistRecoveredSignedEntitlement(await buildCode(activePaid, testKeyPair.privateKey), "teacher");
    const longerPaid = await buildCode({ ...activePaid, entitlementId: "p5c-longer", expiresAt: new Date(Date.now() + 400 * 86400000).toISOString() }, testKeyPair.privateKey);
    const result = await persistRecoveredSignedEntitlement(longerPaid, "teacher");
    expect(result.status).toBe("success_active");
    expect((await readRaw("teacher")).signedCode).toBe(longerPaid.trim());
  });

  it("P6) بعد كل سيناريوهات التزامن (P2/P3) مجتمعة تسلسليًا في نفس الاختبار -> صفر hold عالق نهائيًا، isWriteAllowedSync يعكس الحالة الصحيحة لكل variant", async () => {
    const teacherCode = await buildCode(activePaid, testKeyPair.privateKey);
    const directorCode = await buildCode({ ...activePaid, scope: "director" as const, entitlementId: "p6-director" }, testKeyPair.privateKey);

    await Promise.all([
      persistRecoveredSignedEntitlement(teacherCode, "teacher"),
      persistRecoveredSignedEntitlement(directorCode, "director"),
      persistRecoveredSignedEntitlement(await buildCode({ ...activeTrial, entitlementId: "p6-teacher-weaker" }, testKeyPair.privateKey), "teacher"), // أضعف، متوقَّع رفضها
    ]);

    expect(isWriteAllowedSync("teacher")).toBe(true);
    expect(isWriteAllowedSync("director")).toBe(true);
    const teacherRaw = await readRaw("teacher");
    const directorRaw = await readRaw("director");
    expect(teacherRaw.signedCode).toBe(teacherCode.trim()); // paid فاز، trial الأضعف رُفِضت
    expect(directorRaw.signedCode).toBe(directorCode.trim());
  });
});
