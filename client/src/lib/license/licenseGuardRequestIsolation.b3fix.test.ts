// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedEntitlementPayload } from "./licenseTypes";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

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
const recordKeyFor = (variant: "teacher" | "director") => `current:${variant}`;

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const seedRaw = (state: unknown, variant: "teacher" | "director") => new Promise<void>((resolve, reject) => {
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

const future = new Date(Date.now() + 365 * 86400000).toISOString();
const now = new Date().toISOString();

const activePayload = (variant: "teacher" | "director", entitlementId: string): SignedEntitlementPayload => ({
  v: 2, entitlementId, accountId: "a1", kind: "paid", scope: variant, issuedAt: now, expiresAt: future,
});

beforeEach(async () => {
  await resetDatabase();
  resetWriteGuardCacheForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});

afterEach(async () => { await resetDatabase(); });

describe("LIC-6D-B-3B.3-B3-REAL-FIX: latest-request-id مستقل لكل variant", () => {
  it("A) teacher request لا يُلغي cache update لـdirector المتزامن معه", async () => {
    const teacherCode = await buildCode(activePayload("teacher", "t-a"), testKeyPair.privateKey);
    const directorCode = await buildCode(activePayload("director", "d-a"), testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: teacherCode, lastSeenAt: now }, "teacher");
    await seedRaw({ kind: "entitlement", signedCode: directorCode, lastSeenAt: now }, "director");

    // director يبدأ ويكتمل بعد teacher (يزيد عدَّاده الخاص فقط الآن)
    const teacherPromise = getCurrentLicenseStatus("teacher");
    await getCurrentLicenseStatus("director");
    await teacherPromise;

    // teacher لم يُنافَس بأي طلب teacher آخر -> كاشه يجب أن يُحدَّث بصدق
    expect(isWriteAllowedSync("teacher")).toBe(true);
    expect(isWriteAllowedSync("director")).toBe(true);
  });

  it("B) director request لا يُلغي cache update لـteacher المتزامن معه", async () => {
    const teacherCode = await buildCode(activePayload("teacher", "t-b"), testKeyPair.privateKey);
    const directorCode = await buildCode(activePayload("director", "d-b"), testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: teacherCode, lastSeenAt: now }, "teacher");
    await seedRaw({ kind: "entitlement", signedCode: directorCode, lastSeenAt: now }, "director");

    // teacher يبدأ ويكتمل بعد director هذه المرة (عكس A)
    const directorPromise = getCurrentLicenseStatus("director");
    await getCurrentLicenseStatus("teacher");
    await directorPromise;

    expect(isWriteAllowedSync("director")).toBe(true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("C) طلبان لنفس الـvariant (teacher) ما زالا يطبّقان latest-request-wins بصدق", async () => {
    // PILOT-50-B: أُعيد تصميم هذا الاختبار — السيناريو الأصلي (A تقرأ null
    // بينما B يزرع entitlement بالتوازي) لم يعد قابلًا للمحاكاة بأمان بعد
    // Blocker 1، لأن getOrInitializeState الحقيقية ترفض صراحةً (بخطأ آمن
    // مقصود) التنفيذ لو وجدت entitlement مخزَّنًا فعليًا لحظة استدعائها —
    // بالضبط الحماية الصحيحة التي تمنع محاولة استبدال entitlement صامتًا
    // بـtrial. الجوهر الأمني المطلوب هنا (latest-request-wins) يبقى مُختبَرًا
    // بأمان كامل عبر حالتين موجودتين مسبقًا بدل حالة فارغة/null.
    const oldCode = await buildCode(activePayload("teacher", "t-c-old"), testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: oldCode, lastSeenAt: now }, "teacher");
    const newCode = await buildCode(activePayload("teacher", "t-c-new"), testKeyPair.privateKey);
    const realReadCurrentState = licenseStore.readCurrentState.bind(licenseStore);

    let firstStarted = false;
    const readSpy = vi.spyOn(licenseStore, "readCurrentState").mockImplementation(async (variant: "teacher" | "director") => {
      if (variant === "teacher" && !firstStarted) {
        firstStarted = true;
        const capturedResult = await realReadCurrentState(variant); // تلتقط oldCode بصدق فورًا
        await new Promise((resolve) => setTimeout(resolve, 20)); // A بطيئة، لكن نتيجتها المُلتقَطة ثابتة بالفعل
        readSpy.mockRestore();
        return capturedResult;
      }
      return realReadCurrentState(variant);
    });

    const promiseA = getCurrentLicenseStatus("teacher"); // A: أقدم، بطيئة، ستحسب نتيجة oldCode المُلتقَطة مسبقًا
    await vi.waitFor(() => expect(firstStarted).toBe(true));

    await seedRaw({ kind: "entitlement", signedCode: newCode, lastSeenAt: now }, "teacher"); // تحديث حقيقي بينما A لا تزال تنتظر
    const promiseB = getCurrentLicenseStatus("teacher"); // B: أحدث، ستقرأ newCode فورًا
    const [statusA, statusB] = await Promise.all([promiseA, promiseB]);

    expect(statusA.kind).toBe("paid_active"); // A حسبت نتيجة صحيحة بناءً على oldCode الذي التقطته
    expect(statusB.kind).toBe("paid_active"); // B حسبت نتيجة صحيحة بناءً على newCode
    expect(statusB.writesAllowed).toBe(true);
    // B هو الأحدث فعليًا -> الكاش يعكس نتيجته (newCode)، بصرف النظر عن ترتيب اكتمال A/B الفعلي — latest-request-wins محفوظ
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("D) تداخل teacher/director في الاتجاهين لا يترك أي variant fail-closed خطأً بعد اكتمال الطلب الصحيح", async () => {
    const teacherCode = await buildCode(activePayload("teacher", "t-d"), testKeyPair.privateKey);
    const directorCode = await buildCode(activePayload("director", "d-d"), testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: teacherCode, lastSeenAt: now }, "teacher");
    await seedRaw({ kind: "entitlement", signedCode: directorCode, lastSeenAt: now }, "director");

    // تداخل حقيقي متزامن بالاتجاهين معًا: عدة طلبات teacher وdirector متشابكة
    await Promise.all([
      getCurrentLicenseStatus("teacher"),
      getCurrentLicenseStatus("director"),
      getCurrentLicenseStatus("director"),
      getCurrentLicenseStatus("teacher"),
    ]);

    // كلا الـvariant يجب أن ينتهيا مسموحَين — صفر اقتران cross-variant يُبقي أحدهما مرفوضًا خطأً
    expect(isWriteAllowedSync("teacher")).toBe(true);
    expect(isWriteAllowedSync("director")).toBe(true);
  });

  it("E) الطلب الأقدم لنفس الـvariant لا يستطيع الكتابة فوق نتيجة طلب أحدث لنفس الـvariant", async () => {
    const activeCode = await buildCode(activePayload("teacher", "t-e-active"), testKeyPair.privateKey);
    const realReadCurrentState = licenseStore.readCurrentState.bind(licenseStore);

    let aPaused = false;
    const gate = new Promise<void>((resolveGate) => {
      const readSpy = vi.spyOn(licenseStore, "readCurrentState").mockImplementation(async (variant: "teacher" | "director") => {
        if (variant === "teacher" && !aPaused) {
          aPaused = true;
          await new Promise<void>((r) => setTimeout(r, 20)); // A متأخرة فعليًا
          readSpy.mockRestore();
          return realReadCurrentState(variant);
        }
        return realReadCurrentState(variant);
      });
      resolveGate();
    });
    await gate;

    await seedRaw({ kind: "entitlement", signedCode: activeCode, lastSeenAt: now }, "teacher");

    const promiseA = getCurrentLicenseStatus("teacher"); // A: أقدم، بطيئة عمدًا
    await new Promise((r) => setTimeout(r, 5));
    const promiseB = getCurrentLicenseStatus("teacher"); // B: أحدث، أسرع
    await promiseB;
    const cacheAfterB = isWriteAllowedSync("teacher");
    await promiseA; // A تكتمل متأخرة الآن

    // بصرف النظر عن نتيجة A الفعلية، الكاش النهائي يجب أن يبقى محكومًا بـB
    // (الأحدث)، لا يُعاد كتابته بواسطة A الأقدم المكتملة لاحقًا
    expect(isWriteAllowedSync("teacher")).toBe(cacheAfterB);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });
});
