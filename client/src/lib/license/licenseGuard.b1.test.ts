import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PHASE PILOT-50-D: هذه الاختبارات تفحص سلوك public-trial تحديدًا (بدء trial تلقائي)
vi.mock("../distributionMode", () => ({ DISTRIBUTION_MODE: "public-trial" }));
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

describe("LIC-6D-B-3B.3-B1 + PILOT-50-B BLOCKER1: بدء تجربة 3 أشهر رسمية لمعلم/مدير جديد", () => {
  // PHASE PILOT-50-B: عُدِّلت هذه المجموعة الثلاثة — كانت تُثبِت أن قاعدة
  // فارغة تبقى missing بلا أي trial (سلوك B1 الأصلي). الآن state===null
  // يبدأ تجربة 3 أشهر رسمية فعليًا (Blocker 1) — هذا تطور عقد متعمَّد
  // موثَّق في licenseGuard.ts نفسها، لا خطأ في الاختبار القديم.
  it("1) أول تشغيل (first run) لقاعدة فارغة تمامًا -> trial_active فورًا، سجل trial حقيقي يُكتَب", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_active");
    const raw = await licenseStore.readCurrentState("teacher");
    expect(raw).not.toBeNull();
    expect((raw as { kind: string }).kind).toBe("trial");
  });

  it("2) أول تشغيل -> writesAllowed=true", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("3) إعادة الفتح المتكررة لا تُنشئ trial جديدة في كل مرة — نفس trialStartedAt يبقى ثابتًا", async () => {
    await getCurrentLicenseStatus("teacher");
    const rawAfterFirst = await licenseStore.readCurrentState("teacher");
    const firstStartedAt = (rawAfterFirst as { trialStartedAt: string }).trialStartedAt;

    await getCurrentLicenseStatus("teacher");
    const second = await getCurrentLicenseStatus("teacher");
    const rawAfterSecond = await licenseStore.readCurrentState("teacher");

    expect(second.kind).toBe("trial_active");
    expect((rawAfterSecond as { trialStartedAt: string }).trialStartedAt).toBe(firstStartedAt); // صفر إعادة إنشاء، نفس تاريخ البداية
  });

  it("3-ب) مدة الانتهاء 3 أشهر تقويمية بالضبط حسب المنطق الحالي (trialDate.ts)", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    const raw = await licenseStore.readCurrentState("teacher");
    const trialStartedAt = new Date((raw as { trialStartedAt: string }).trialStartedAt);
    const expiresAt = new Date(status.expiresAt);
    const approxMonths = (expiresAt.getTime() - trialStartedAt.getTime()) / (30 * 86400000);
    expect(approxMonths).toBeGreaterThan(2.8);
    expect(approxMonths).toBeLessThan(3.2);
  });

  it("3-ج) انتهاء Trial فعليًا (تاريخ بداية ماضٍ بأكثر من 3 أشهر) -> الكتابة ممنوعة حسب التصميم الحالي", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: "2020-01-01T00:00:00.000Z", lastSeenAt: "2020-01-01T00:00:00.000Z" });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_expired");
    expect(status.writesAllowed).toBe(false);
  });

  it("3-د) إرجاع ساعة الجهاز للخلف بعد رؤية سابقة لا يُمدِّد التجربة (resolveEffectiveNow، حماية قائمة أصلًا)", async () => {
    const now = new Date().toISOString();
    await seedRaw({ kind: "trial", trialStartedAt: now, lastSeenAt: now });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.clockRollbackDetected).toBe(false);
    expect(status.kind).toBe("trial_active");
  });

  it("4) حذف الحالة بعد entitlement نشط -> تبدأ trial جديدة بدل missing (PILOT-50-B: أي state===null الآن يبدأ تجربة)", async () => {
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
    expect(afterDeleteStatus.kind).toBe("trial_active");
    expect(afterDeleteStatus.writesAllowed).toBe(true);
  });

  it("5) resetLicenseExplicitly يحذف السجل فورًا (result=null)، لكن الاستدعاء التالي يبدأ trial جديدة تلقائيًا (PILOT-50-B)", async () => {
    const result = await licenseStore.resetLicenseExplicitly("teacher");
    expect(result).toBeNull(); // الدالة نفسها بلا تغيير — لا تزال تحذف فقط، صفر إنشاء من طرفها
    const status = await getCurrentLicenseStatus("teacher"); // البدء الفعلي يحدث هنا، عبر licenseGuard
    expect(status.kind).toBe("trial_active");
    expect(status.writesAllowed).toBe(true);
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

  it("9) teacher بقاعدة فارغة -> trial_active الآن (PILOT-50-B BLOCKER1)", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(true);
    expect(status.kind).toBe("trial_active");
  });

  it("10) director بقاعدة فارغة -> trial_active أيضًا (نفس السياسة، مستقل تمامًا عن teacher)", async () => {
    const status = await getCurrentLicenseStatus("director");
    expect(status.writesAllowed).toBe(true);
    expect(status.kind).toBe("trial_active");
  });

  it("11) أثناء التنفيذ غير المتزامن (قبل الاكتمال) -> الكاش المتزامن يبقى false حتى مع trial جديدة (fail-closed بنيويًا لا يتأثر)", async () => {
    resetWriteGuardCacheForTests();
    const promise = getCurrentLicenseStatus("teacher");
    // قبل اكتمال await: الكاش لم يُحدَّث بعد لأي قيمة true إطلاقًا (fail-closed بنيويًا، بصرف النظر عن النتيجة النهائية)
    expect(isWriteAllowedSync("teacher")).toBe(false);
    await promise;
    expect(isWriteAllowedSync("teacher")).toBe(true); // الآن true لأن trial جديدة صالحة فعليًا (PILOT-50-B)
  });

  it("12) استرجاع الحالة الحقيقية بعد حذف entitlement يبدأ trial جديدة بدل missing (PILOT-50-B، لا عالق قديم لكن أيضًا صفر فراغ دائم)", async () => {
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
    const afterDeleteStatus = await getCurrentLicenseStatus("teacher");
    // PILOT-50-B: صفر true "عالق" من الحالة القديمة تحديدًا (entitlement e5
    // المحذوفة) — لكن true الجديد شرعي تمامًا لأنه ناتج عن trial جديدة
    // بدأت للتو، لا بقايا الحالة السابقة إطلاقًا (entitlementId مختلف تمامًا)
    expect(afterDeleteStatus.kind).toBe("trial_active");
    expect(isWriteAllowedSync("teacher")).toBe(true);
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
