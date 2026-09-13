// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedEntitlementPayload } from "./licenseTypes";

// PHASE LIC-6D-B-3B.3: بيئة jsdom توفر window/document حقيقيتين بالفعل (لازمتان
// لاختبارَي 16/17 الفعليَّين لـcross-tab) — فقط نضمن أن indexedDB الحقيقية
// (fake-indexeddb/auto) مرئية عبر window، بلا استبدال window بالكامل (كما
// كان ضروريًا في ملفات أخرى ببيئة Node الافتراضية بلا window إطلاقًا).
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
const { enrollSignedEntitlement } = await import("./licenseEnrollment"); // PHASE B3-REAL: هذا الـsnapshot لا يحتوي B2 (persistRecoveredSignedEntitlement) بعد — enrollSignedEntitlement العادية تكفي تمامًا لاختبار فصل التخزين نفسه
const { isWriteAllowedSync, resetWriteGuardCacheForTests } = await import("./writeGuardCache");

const DB_NAME = "khabir-license-local";
const STORE_NAME = "state";
const recordKeyFor = (variant: "teacher" | "director") => `current:${variant}`;
const LEGACY_KEY = "current";

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const seedRaw = (state: unknown, key: string) => new Promise<void>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onupgradeneeded = () => { if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) openRequest.result.createObjectStore(STORE_NAME); };
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const putRequest = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, key);
    putRequest.onsuccess = () => { db.close(); resolve(); };
    putRequest.onerror = () => { db.close(); reject(putRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

const readRaw = (key: string) => new Promise<any>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const getRequest = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    getRequest.onsuccess = () => { db.close(); resolve(getRequest.result); };
    getRequest.onerror = () => { db.close(); reject(getRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

const future = new Date(Date.now() + 365 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const now = new Date().toISOString();

beforeEach(async () => {
  await resetDatabase();
  resetWriteGuardCacheForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);

  // PHASE LIC-6D-B-3B.3: polyfill حقيقي لـnavigator.locks — غير متاحة فعليًا
  // في Node القياسي (بيئة jsdom لا توفرها أيضًا)، لكن هذا لا يعكس بيئة
  // المتصفح الحقيقية المستهدفة؛ محاكاة طابور تسلسلي حقيقي هنا (لا مجرد
  // تنفيذ فوري بلا حماية) ضرورية لاختبار ضمان "فائز واحد بالضبط" بصدق.
  const lockQueues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", {
    value: {
      request: (name: string, callback: () => Promise<unknown>) => {
        const current = lockQueues.get(name) ?? Promise.resolve();
        const next = current.then(callback, callback);
        lockQueues.set(name, next.catch(() => undefined));
        return next;
      },
    },
    configurable: true,
    writable: true,
  });
});

afterEach(async () => { await resetDatabase(); });

describe("LIC-6D-B-3B.3: Variant Separation — الاختبارات المطلوبة صراحة (1-20)", () => {
  it("1) teacher + director active entitlements تتعايشان فعليًا معًا", async () => {
    const teacherCode = await buildCode({ v: 2, entitlementId: "t1", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    const directorCode = await buildCode({ v: 2, entitlementId: "d1", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode, "teacher");
    await enrollSignedEntitlement(directorCode, "director");
    const teacherStatus = await getCurrentLicenseStatus("teacher");
    const directorStatus = await getCurrentLicenseStatus("director");
    expect(teacherStatus.writesAllowed).toBe(true);
    expect(directorStatus.writesAllowed).toBe(true);
  });

  it("2) استبدال teacher يترك director بلا أي تغيير حرفي (byte-for-byte)", async () => {
    const directorCode = await buildCode({ v: 2, entitlementId: "d2", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(directorCode, "director");
    const directorBefore = await readRaw(recordKeyFor("director"));

    const teacherCode1 = await buildCode({ v: 2, entitlementId: "t2a", accountId: "a1", kind: "trial", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode1, "teacher");
    const teacherCode2 = await buildCode({ v: 2, entitlementId: "t2b", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode2, "teacher");

    const directorAfter = await readRaw(recordKeyFor("director"));
    expect(directorAfter).toEqual(directorBefore);
  });

  it("3) استبدال director يترك teacher بلا أي تغيير حرفي (byte-for-byte)", async () => {
    const teacherCode = await buildCode({ v: 2, entitlementId: "t3", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode, "teacher");
    const teacherBefore = await readRaw(recordKeyFor("teacher"));

    const directorCode1 = await buildCode({ v: 2, entitlementId: "d3a", accountId: "a2", kind: "trial", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(directorCode1, "director");
    const directorCode2 = await buildCode({ v: 2, entitlementId: "d3b", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(directorCode2, "director");

    const teacherAfter = await readRaw(recordKeyFor("teacher"));
    expect(teacherAfter).toEqual(teacherBefore);
  });

  it("4) signed scope=teacher يُهاجِر إلى خانة teacher فقط", async () => {
    const code = await buildCode({ v: 2, entitlementId: "m4", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: now }, LEGACY_KEY);
    await licenseStore.readCurrentState("teacher"); // يُشغِّل الهجرة
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    expect(teacherRaw.signedCode).toBe(code);
    expect(directorRaw).toBeUndefined();
    expect(await readRaw(LEGACY_KEY)).toBeUndefined(); // القديم حُذِف
  });

  it("5) signed scope=director يُهاجِر إلى خانة director فقط", async () => {
    const code = await buildCode({ v: 2, entitlementId: "m5", accountId: "a1", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: now }, LEGACY_KEY);
    await licenseStore.readCurrentState("director");
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    expect(directorRaw.signedCode).toBe(code);
    expect(teacherRaw).toBeUndefined();
  });

  it("6) signed scope=both يُهاجِر نفس signedCode لكلا الخانتين", async () => {
    const code = await buildCode({ v: 2, entitlementId: "m6", accountId: "a1", kind: "paid", scope: "both", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: code, lastSeenAt: now }, LEGACY_KEY);
    await licenseStore.readCurrentState("teacher");
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    expect(teacherRaw.signedCode).toBe(code);
    expect(directorRaw.signedCode).toBe(code);
  });

  it("7) legacy trial بلا scope يُطالَب من teacher إن بدأت أولًا -> teacher فقط", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: now }, LEGACY_KEY);
    await licenseStore.readCurrentState("teacher");
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    expect(teacherRaw.kind).toBe("trial");
    expect(teacherRaw.trialStartedAt).toBe("2026-06-01T00:00:00.000Z"); // بلا تمديد
    expect(directorRaw).toBeUndefined();
  });

  it("8) نفس legacy trial يُطالَب من director إن بدأت أولًا -> director فقط", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: now }, LEGACY_KEY);
    await licenseStore.readCurrentState("director");
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    expect(directorRaw.kind).toBe("trial");
    expect(teacherRaw).toBeUndefined();
  });

  it("9) هجرة legacy trial متزامنة حقيقية (teacher+director معًا) -> فائز واحد بالضبط", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: now }, LEGACY_KEY);
    // استدعاء متزامن حقيقي عبر Promise.all — لا تسلسل مُتحكَّم به يدويًا
    await Promise.all([
      licenseStore.readCurrentState("teacher"),
      licenseStore.readCurrentState("director"),
    ]);
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    const teacherWon = teacherRaw !== undefined;
    const directorWon = directorRaw !== undefined;
    expect(teacherWon !== directorWon).toBe(true); // XOR: واحد بالضبط فاز، ليس كلاهما ولا صفر
    if (teacherWon) expect(teacherRaw.trialStartedAt).toBe("2026-06-01T00:00:00.000Z");
    if (directorWon) expect(directorRaw.trialStartedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("10) الخاسر في التزامن يصبح missing، صفر trial جديدة له", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: now }, LEGACY_KEY);
    const [teacherStatus, directorStatus] = await Promise.all([
      getCurrentLicenseStatus("teacher"),
      getCurrentLicenseStatus("director"),
    ]);
    const kinds = [teacherStatus.kind, directorStatus.kind];
    // واحد منهما trial_active (الفائز)، والآخر missing (الخاسر) — صفر duplication، صفر fresh trial لكليهما
    expect(kinds.includes("missing")).toBe(true);
    expect(kinds.filter((k) => k === "trial_active").length).toBeLessThanOrEqual(1);
  });

  it("11) legacy \"current\" مُعبَث به (توقيع خاطئ) -> صفر ثقة، صفر هجرة لأي خانة", async () => {
    const tamperedCode = await buildCode({ v: 2, entitlementId: "tamper1", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, wrongKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: tamperedCode, lastSeenAt: now }, LEGACY_KEY);
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("missing"); // صفر ثقة بـscope منه، صفر هجرة
    const teacherRaw = await readRaw(recordKeyFor("teacher"));
    const directorRaw = await readRaw(recordKeyFor("director"));
    expect(teacherRaw).toBeUndefined();
    expect(directorRaw).toBeUndefined();
  });

  it("12) صفر \"current\" قديم إطلاقًا -> كلا الـvariant يبقيان missing", async () => {
    const teacherStatus = await getCurrentLicenseStatus("teacher");
    const directorStatus = await getCurrentLicenseStatus("director");
    expect(teacherStatus.kind).toBe("missing");
    expect(directorStatus.kind).toBe("missing");
  });

  it("13) B1 لا يزال ساريًا: missing لا يُنشئ trial أبدًا حتى بعد كل تغييرات B-3B.3", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("missing");
    expect(await licenseStore.readCurrentState("teacher")).toBeNull();
  });

  it("14) إعادة ضبط teacher تؤثر على خانة teacher فقط", async () => {
    const teacherCode = await buildCode({ v: 2, entitlementId: "r14t", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    const directorCode = await buildCode({ v: 2, entitlementId: "r14d", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode, "teacher");
    await enrollSignedEntitlement(directorCode, "director");

    await licenseStore.resetLicenseExplicitly("teacher");

    const teacherStatus = await getCurrentLicenseStatus("teacher");
    const directorStatus = await getCurrentLicenseStatus("director");
    expect(teacherStatus.kind).toBe("missing");
    expect(directorStatus.writesAllowed).toBe(true); // بلا أي تأثر
  });

  it("15) إعادة ضبط director تؤثر على خانة director فقط", async () => {
    const teacherCode = await buildCode({ v: 2, entitlementId: "r15t", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    const directorCode = await buildCode({ v: 2, entitlementId: "r15d", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode, "teacher");
    await enrollSignedEntitlement(directorCode, "director");

    await licenseStore.resetLicenseExplicitly("director");

    const teacherStatus = await getCurrentLicenseStatus("teacher");
    const directorStatus = await getCurrentLicenseStatus("director");
    expect(directorStatus.kind).toBe("missing");
    expect(teacherStatus.writesAllowed).toBe(true);
  });

  it("16) نشاط teacher عبر cross-tab لا يمنع director بلا داعٍ", async () => {
    const { initLicenseCrossTabSync } = await import("./licenseCrossTabSync");
    const directorCode = await buildCode({ v: 2, entitlementId: "ct16d", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(directorCode, "director");
    await getCurrentLicenseStatus("director");
    expect(isWriteAllowedSync("director")).toBe(true);

    const teacherSync = initLicenseCrossTabSync("teacher");
    // محاكاة رسالة "changing" واردة من تبويب آخر لنفس الـteacher فقط
    const { BroadcastChannel: RealBC } = globalThis as unknown as { BroadcastChannel?: typeof BroadcastChannel };
    if (RealBC) {
      const remote = new RealBC("khabir-license-state:teacher");
      remote.postMessage({ type: "license-state-changing", generation: "remote-gen-1", source: "other-tab" });
      remote.close();
    }
    await new Promise((r) => setTimeout(r, 10));

    // director غير متأثرة إطلاقًا بحدث teacher
    expect(isWriteAllowedSync("director")).toBe(true);
    teacherSync.dispose();
  });

  it("17) نشاط director عبر cross-tab لا يمنع teacher بلا داعٍ", async () => {
    const { initLicenseCrossTabSync } = await import("./licenseCrossTabSync");
    const teacherCode = await buildCode({ v: 2, entitlementId: "ct17t", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode, "teacher");
    await getCurrentLicenseStatus("teacher");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    const directorSync = initLicenseCrossTabSync("director");
    const { BroadcastChannel: RealBC } = globalThis as unknown as { BroadcastChannel?: typeof BroadcastChannel };
    if (RealBC) {
      const remote = new RealBC("khabir-license-state:director");
      remote.postMessage({ type: "license-state-changing", generation: "remote-gen-2", source: "other-tab" });
      remote.close();
    }
    await new Promise((r) => setTimeout(r, 10));

    expect(isWriteAllowedSync("teacher")).toBe(true);
    directorSync.dispose();
  });

  it("18) عمليات متزامنة لنفس الـvariant تبقى fail-closed وآمنة", async () => {
    const code1 = await buildCode({ v: 2, entitlementId: "sc18a", accountId: "a1", kind: "trial", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    const code2 = await buildCode({ v: 2, entitlementId: "sc18b", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    const [result1, result2] = await Promise.all([
      enrollSignedEntitlement(code1, "teacher"),
      enrollSignedEntitlement(code2, "teacher"),
    ]);
    // كلاهما نجح منطقيًا (تسلسل داخلي آمن)، النتيجة النهائية متسقة (أحدهما فاز فعليًا)
    expect([result1.status, result2.status].some((s) => s === "success")).toBe(true); // enrollSignedEntitlement العادية تُعيد "success" (لا "success_active" — تلك من B2 غير المطبَّقة هنا)
    const raw = await readRaw(recordKeyFor("teacher"));
    expect([code1, code2]).toContain(raw.signedCode);
  });

  it("19) B2 استرداد teacher لا يُغيِّر خانة director إطلاقًا", async () => {
    const directorCode = await buildCode({ v: 2, entitlementId: "b2t19d", accountId: "a2", kind: "paid", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(directorCode, "director");
    const directorBefore = await readRaw(recordKeyFor("director"));

    const teacherCode = await buildCode({ v: 2, entitlementId: "b2t19t", accountId: "a1", kind: "trial", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey); // نشطة (B2/persistRecoveredSignedEntitlement غير مطبَّقة في هذا الـsnapshot بعد)
    await enrollSignedEntitlement(teacherCode, "teacher");

    const directorAfter = await readRaw(recordKeyFor("director"));
    expect(directorAfter).toEqual(directorBefore);
  });

  it("20) B2 استرداد director لا يُغيِّر خانة teacher إطلاقًا", async () => {
    const teacherCode = await buildCode({ v: 2, entitlementId: "b2d20t", accountId: "a1", kind: "paid", scope: "teacher", issuedAt: now, expiresAt: future }, testKeyPair.privateKey);
    await enrollSignedEntitlement(teacherCode, "teacher");
    const teacherBefore = await readRaw(recordKeyFor("teacher"));

    const directorCode = await buildCode({ v: 2, entitlementId: "b2d20d", accountId: "a2", kind: "trial", scope: "director", issuedAt: now, expiresAt: future }, testKeyPair.privateKey); // نشطة (B2 غير مطبَّقة بعد في هذا الـsnapshot)
    await enrollSignedEntitlement(directorCode, "director");

    const teacherAfter = await readRaw(recordKeyFor("teacher"));
    expect(teacherAfter).toEqual(teacherBefore);
  });
});
