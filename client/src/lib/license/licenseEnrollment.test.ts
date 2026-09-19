import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PHASE PILOT-50-D: هذه الاختبارات تفحص سلوك public-trial تحديدًا (بدء trial تلقائي)
vi.mock("../distributionMode", () => ({ DISTRIBUTION_MODE: "public-trial" }));
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
const { enrollSignedEntitlement } = await import("./licenseEnrollment");
const { isWriteAllowedSync, resetWriteGuardCacheForTests } = await import("./writeGuardCache");

const DB_NAME = "khabir-license-local";
const STORE_NAME = "state";
const recordKeyFor = (variant: string) => `current:${variant}`;

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
});

beforeEach(async () => {
  await resetDatabase();
  resetWriteGuardCacheForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});

const future = "2027-09-09T00:00:00.000Z";
const nearFuture = "2026-12-09T00:00:00.000Z";
const farFuture = "2028-09-09T00:00:00.000Z";
const past = "2025-09-09T00:00:00.000Z";
const trial: SignedEntitlementPayload = { v: 2, entitlementId: "e1", accountId: "a1", kind: "trial", scope: "both", issuedAt: "2026-09-09T00:00:00.000Z", expiresAt: future };

describe("licenseEnrollment — LIC-6C.1", () => {
  it("1) valid active trial saves", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
    expect((await readRaw()).kind).toBe("entitlement");
  });

  it("2) valid active paid saves", async () => {
    const code = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
  });

  it("3) tampered code rejected, old state preserved", async () => {
    const oldCode = await buildCode(trial, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: oldCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const result = await enrollSignedEntitlement("tampered.garbage", "teacher");
    expect(result.status).toBe("invalid");
    expect((await readRaw()).signedCode).toBe(oldCode);
  });

  it("4) [PILOT-50-B: تطور عقد] malformed code rejected — no prior state -> central reproof path now starts a fresh trial via Blocker 1 (was: stayed missing under old B1)", async () => {
    const result = await enrollSignedEntitlement("not-even-two-parts", "teacher");
    expect(result.status).toBe("invalid");
    const after = await licenseStore.readCurrentState("teacher");
    expect(after).not.toBeNull();
    expect((after as { kind: string }).kind).toBe("trial"); // PILOT-50-B Blocker1: بداية trial تلقائية، لا missing دائم
  });

  it("5) [PILOT-50-B: تطور عقد] expired trial rejected — no prior state -> reproof starts a fresh trial (Blocker 1), not missing", async () => {
    const code = await buildCode({ ...trial, expiresAt: past }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("expired");
    const after = await licenseStore.readCurrentState("teacher");
    expect(after).not.toBeNull();
    expect((after as { kind: string }).kind).toBe("trial");
  });

  it("6) expired paid rejected", async () => {
    const code = await buildCode({ ...trial, kind: "paid", expiresAt: past }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("expired");
  });

  it("7) wrong scope rejected (teacher code enrolled as director)", async () => {
    const code = await buildCode({ ...trial, scope: "teacher" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "director");
    expect(result.status).toBe("wrong_scope");
  });

  it("8) scope both accepted for teacher and director", async () => {
    const codeT = await buildCode(trial, testKeyPair.privateKey);
    expect((await enrollSignedEntitlement(codeT, "teacher")).status).toBe("success");
    await resetDatabase();
    const codeD = await buildCode(trial, testKeyPair.privateKey);
    expect((await enrollSignedEntitlement(codeD, "director")).status).toBe("success");
  });

  it("9) normalized signedCode persisted exactly (input already has no surrounding whitespace here)", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    expect((await readRaw()).signedCode).toBe(code);
  });

  it("9b) POLICY: input IS normalized (trim only) before verification/persistence — surrounding whitespace is stripped, not preserved byte-exact", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    const withWhitespace = `  \n${code}\t  `;
    const result = await enrollSignedEntitlement(withWhitespace, "teacher");
    expect(result.status).toBe("success");
    expect((await readRaw()).signedCode).toBe(code); // مطبَّع (trim)، لا يحمل المسافات الأصلية
  });

  it("10) parsed payload NOT persisted — only kind/signedCode/lastSeenAt fields exist", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    const raw = await readRaw();
    expect(Object.keys(raw).sort()).toEqual(["kind", "lastSeenAt", "signedCode"].sort());
    expect(raw).not.toHaveProperty("accountId");
    expect(raw).not.toHaveProperty("expiresAt");
  });

  it("11) lastSeenAt initialized correctly (close to now, no prior state)", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    const before = Date.now();
    await enrollSignedEntitlement(code, "teacher");
    const raw = await readRaw();
    expect(new Date(raw.lastSeenAt).getTime()).toBeGreaterThanOrEqual(before - 5000);
  });

  it("12) lastSeenAt never moves backwards on replacement (invalid->valid upgrade path)", async () => {
    await seedRaw({ kind: "entitlement", signedCode: "garbage", lastSeenAt: "2099-01-01T00:00:00.000Z" });
    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    const raw = await readRaw();
    expect(raw.lastSeenAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("13) active trial -> paid allowed", async () => {
    const trialCode = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(trialCode, "teacher");
    const paidCode = await buildCode({ ...trial, entitlementId: "e2", kind: "paid" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(paidCode, "teacher");
    expect(result.status).toBe("success");
  });

  it("14) active paid -> trial denied", async () => {
    const paidCode = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await enrollSignedEntitlement(paidCode, "teacher");
    const trialCode = await buildCode({ ...trial, entitlementId: "e2" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(trialCode, "teacher");
    expect(result.status).toBe("downgrade_rejected");
  });

  it("15) active trial -> shorter trial denied", async () => {
    const longCode = await buildCode({ ...trial, expiresAt: farFuture }, testKeyPair.privateKey);
    await enrollSignedEntitlement(longCode, "teacher");
    const shortCode = await buildCode({ ...trial, entitlementId: "e2", expiresAt: nearFuture }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(shortCode, "teacher");
    expect(result.status).toBe("downgrade_rejected");
  });

  it("16) active trial -> equal/later trial accepted", async () => {
    const code1 = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code1, "teacher");
    const code2 = await buildCode({ ...trial, entitlementId: "e2", expiresAt: farFuture }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code2, "teacher");
    expect(result.status).toBe("success");
  });

  it("17) active paid -> shorter paid denied", async () => {
    const longCode = await buildCode({ ...trial, kind: "paid", expiresAt: farFuture }, testKeyPair.privateKey);
    await enrollSignedEntitlement(longCode, "teacher");
    const shortCode = await buildCode({ ...trial, entitlementId: "e2", kind: "paid", expiresAt: nearFuture }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(shortCode, "teacher");
    expect(result.status).toBe("downgrade_rejected");
  });

  it("18) active paid -> equal/later paid accepted", async () => {
    const code1 = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await enrollSignedEntitlement(code1, "teacher");
    const code2 = await buildCode({ ...trial, entitlementId: "e2", kind: "paid", expiresAt: farFuture }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code2, "teacher");
    expect(result.status).toBe("success");
  });

  it("19) invalid existing entitlement can be replaced by valid", async () => {
    await seedRaw({ kind: "entitlement", signedCode: "garbage", lastSeenAt: "2020-01-01T00:00:00.000Z" });
    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
  });

  it("20) expired existing entitlement can be replaced by valid", async () => {
    const expiredCode = await buildCode({ ...trial, expiresAt: past }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: expiredCode, lastSeenAt: "2020-01-01T00:00:00.000Z" });
    const newCode = await buildCode({ ...trial, entitlementId: "e2" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(newCode, "teacher");
    expect(result.status).toBe("success");
  });

  it("21) legacy local trial -> signed entitlement allowed", async () => {
    await seedRaw({ kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
  });

  it("22) legacy v1 paid -> signed paid allowed", async () => {
    await seedRaw({ kind: "activated", licenseId: "lic-1", scope: "both", activatedAt: "2026-06-01T00:00:00.000Z", expiresAt: future, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const code = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
  });

  it("23) legacy v1 paid -> signed trial denied", async () => {
    await seedRaw({ kind: "activated", licenseId: "lic-1", scope: "both", activatedAt: "2026-06-01T00:00:00.000Z", expiresAt: future, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("downgrade_rejected");
  });

  it("24) verification failure with an EXISTING prior state performs no write to signedCode — only lastSeenAt legitimately advances via the central restore/touch path", async () => {
    const oldCode = await buildCode(trial, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: oldCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    await enrollSignedEntitlement("garbage", "teacher");
    const after = await licenseStore.readCurrentState("teacher");
    expect(after?.kind).toBe("entitlement");
    expect((after as { signedCode: string }).signedCode).toBe(oldCode); // signedCode لم يتغيَّر
    // lastSeenAt قد تتقدَّم شرعًا (لمسة عادية عبر إعادة الإثبات المركزية)، هذا متوقَّع وصحيح، لا خطأ
  });

  it("25) persistence failure does not intentionally delete old state", async () => {
    const oldCode = await buildCode(trial, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: oldCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const spy = vi.spyOn(licenseStore, "saveVerifiedSignedEntitlement").mockRejectedValueOnce(new Error("disk full"));
    const newCode = await buildCode({ ...trial, entitlementId: "e2" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(newCode, "teacher");
    expect(result.status).toBe("persistence_error");
    expect((await readRaw()).signedCode).toBe(oldCode);
    spy.mockRestore();
  });

  it("26) writes fail-closed while enrollment pending (checked synchronously right after call)", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    const promise = enrollSignedEntitlement(code, "teacher");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    await promise;
  });

  it("27) stale enrollment A cannot overwrite newer B", async () => {
    const codeA = await buildCode(trial, testKeyPair.privateKey);
    const promiseA = enrollSignedEntitlement(codeA, "teacher");
    const codeB = await buildCode({ ...trial, entitlementId: "e2", kind: "paid" }, testKeyPair.privateKey);
    const resultB = await enrollSignedEntitlement(codeB, "teacher");
    const resultA = await promiseA;
    expect(resultB.status).toBe("success");
    // بفضل القفل التسلسلي (runExclusive)، A تُنفَّذ بالكامل أولًا دائمًا (نجاحًا)، ثم B تُنفَّذ بعدها وتُصبح النهائية وفق سياسة الترقية
    const raw = await readRaw();
    const finalPayload = JSON.parse(atob(raw.signedCode.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(finalPayload.entitlementId).toBe("e2");
  });

  it("28) double submit cannot cause unsafe state (rapid concurrent identical calls)", async () => {
    const code = await buildCode(trial, testKeyPair.privateKey);
    const [r1, r2] = await Promise.all([enrollSignedEntitlement(code, "teacher"), enrollSignedEntitlement(code, "teacher")]);
    expect([r1.status, r2.status].some((s) => s === "success")).toBe(true);
    const raw = await readRaw();
    expect(raw.kind).toBe("entitlement");
  });

  it("29) startup reverifies saved entitlement after enrollment (getCurrentLicenseStatus reflects it)", async () => {
    const { getCurrentLicenseStatus } = await import("./licenseGuard");
    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBe("trial_active");
    expect(status.writesAllowed).toBe(true);
  });

  it("30) tampering persisted signedCode after enrollment causes writes denied on next verification", async () => {
    const { getCurrentLicenseStatus } = await import("./licenseGuard");
    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    await seedRaw({ kind: "entitlement", signedCode: "tampered-after-the-fact", lastSeenAt: new Date().toISOString() });
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.writesAllowed).toBe(false);
  });

  it("31) teacher and director both work independently", async () => {
    const codeT = await buildCode(trial, testKeyPair.privateKey);
    const resultT = await enrollSignedEntitlement(codeT, "teacher");
    expect(resultT.status).toBe("success");
    await resetDatabase();
    const codeD = await buildCode({ ...trial, scope: "director" }, testKeyPair.privateKey);
    const resultD = await enrollSignedEntitlement(codeD, "director");
    expect(resultD.status).toBe("success");
  });

  it("32) read/export/backup unaffected when writes denied due to failed enrollment", async () => {
    const { licenseStore: store } = await import("./licenseStore");
    await enrollSignedEntitlement("garbage", "teacher");
    // القراءة تعمل بلا أي حراسة كتابة إطلاقًا
    await expect(store.readCurrentState()).resolves.not.toThrow();
  });

  // ===== PHASE LIC-6C.1-FIX: اختبارات إضافية إلزامية =====

  it("FIX-2A) existing valid paid + invalid new code -> invalid, old state unchanged, cache restored to true", async () => {
    const existingCode = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: existingCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const result = await enrollSignedEntitlement("garbage", "teacher");
    expect(result.status).toBe("invalid");
    expect((await readRaw()).signedCode).toBe(existingCode);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("FIX-2B) [PILOT-50-B: تطور عقد] existing valid paid (خانة teacher) + wrong-scope code لـdirector -> رُفِض، خانة director تبدأ trial جديدة عبر Blocker 1 (لا تبقى missing)، خانة teacher الأصلية سليمة تمامًا", async () => {
    const existingCode = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: existingCode, lastSeenAt: "2026-09-09T00:00:00.000Z" }, "teacher");
    const wrongScopeCode = await buildCode({ ...trial, entitlementId: "e2", scope: "teacher" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(wrongScopeCode, "director");
    expect(result.status).toBe("wrong_scope");
    // خانة director لم تكن موجودة أصلًا -> بدأت trial جديدة عبر Blocker 1 (PILOT-50-B)، صفر علاقة بخانة teacher المنفصلة
    expect(isWriteAllowedSync("director")).toBe(true);
    const directorRaw = await readRaw("director");
    expect((directorRaw as { kind: string }).kind).toBe("trial");
    // خانة teacher الأصلية سليمة تمامًا كما كانت
    expect((await readRaw("teacher")).signedCode).toBe(existingCode);
  });

  it("FIX-2C) existing valid paid + downgrade rejected -> old state unchanged, cache restored", async () => {
    const existingCode = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: existingCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const trialCode = await buildCode({ ...trial, entitlementId: "e2" }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(trialCode, "teacher");
    expect(result.status).toBe("downgrade_rejected");
    expect((await readRaw()).signedCode).toBe(existingCode);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("FIX-2D) persistence failure -> old state remains, cache restored via central re-verification", async () => {
    const existingCode = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: existingCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });
    const spy = vi.spyOn(licenseStore, "saveVerifiedSignedEntitlement").mockRejectedValueOnce(new Error("disk full"));
    const newCode = await buildCode({ ...trial, entitlementId: "e2", kind: "paid", expiresAt: farFuture }, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(newCode, "teacher");
    expect(result.status).toBe("persistence_error");
    expect((await readRaw()).signedCode).toBe(existingCode);
    expect(isWriteAllowedSync("teacher")).toBe(true);
    spy.mockRestore();
  });

  it("FIX2-1) قفل تسلسلي: حتى لو A متوقفة يدويًا داخل نداء الحفظ نفسه، B تنتظر حتمًا حتى اكتمال A الكامل، ثم تُنفَّذ وتصبح النهائية — لا اعتماد على توقيت طبيعي", async () => {
    const codeA = await buildCode(trial, testKeyPair.privateKey);
    const codeB = await buildCode({ ...trial, entitlementId: "e2", kind: "paid" }, testKeyPair.privateKey);

    const realSave = licenseStore.saveVerifiedSignedEntitlement.bind(licenseStore);
    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseA = resolve; });
    const callOrder: string[] = [];
    const saveSpy = vi.spyOn(licenseStore, "saveVerifiedSignedEntitlement").mockImplementation(async (code: string, lastSeenAt: string, variant: "teacher" | "director") => {
      callOrder.push(code === codeA ? "A" : "B");
      if (code === codeA) await gate; // A متوقفة يدويًا داخل الحفظ نفسه — سيناريو §5 بالضبط
      return realSave(code, lastSeenAt, variant);
    });

    const promiseA = enrollSignedEntitlement(codeA, "teacher");
    await vi.waitFor(() => expect(callOrder).toContain("A"));

    // B يُستدعى الآن بينما A لا تزال متوقفة داخل الحفظ — القفل التسلسلي يمنع B من البدء إطلاقًا حتى تكتمل A
    const promiseB = enrollSignedEntitlement(codeB, "teacher");

    releaseA();
    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    expect(resultA.status).toBe("success");
    expect(resultB.status).toBe("success");
    // الترتيب الحتمي مضمون بنيويًا عبر القفل: A تكتمل بالكامل أولًا، ثم B تبدأ فقط بعدها
    expect(callOrder).toEqual(["A", "B"]);

    const finalRaw = await readRaw();
    const finalPayload = JSON.parse(atob(finalRaw.signedCode.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(finalPayload.entitlementId).toBe("e2"); // B هي النهائية دائمًا، لا يمكن لـA الكتابة فوقها إطلاقًا

    saveSpy.mockRestore();
  });

  it("FIX3-1) [§4/§5, نفس الـvariant] B يُستدعى (pending فورًا ومتزامنًا) أثناء استعادة A الفاشلة — isWriteAllowedSync=false يُثبَت صراحة في اللحظة الدقيقة عند الاستدعاء، ولا تنكشف true زائفة من استعادة A طالما B لا يزال معلَّقًا في نفس النقطة", async () => {
    const existingCode = await buildCode({ ...trial, kind: "paid" }, testKeyPair.privateKey);
    await seedRaw({ kind: "entitlement", signedCode: existingCode, lastSeenAt: "2026-09-09T00:00:00.000Z" });

    const realReadCurrentState = licenseStore.readCurrentState.bind(licenseStore);
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let aPaused = false;
    const readSpy = vi.spyOn(licenseStore, "readCurrentState").mockImplementation(async (variant: "teacher" | "director") => {
      if (!aPaused) { aPaused = true; await gateA; }
      return realReadCurrentState(variant);
    });

    // A: trial جديد مقابل paid موجود بالفعل -> downgrade_rejected -> fail() -> استعادة (readCurrentState تتوقف هنا داخل isReplacementAllowed)
    const codeA = await buildCode(trial, testKeyPair.privateKey);
    const promiseARealCall = enrollSignedEntitlement(codeA, "teacher");
    await vi.waitFor(() => expect(aPaused).toBe(true));

    // §2/§4: استدعاء B الآن فقط (بلا انتظار تنفيذه) — يجب أن يُصبح pending فورًا ومتزامنًا
    const codeB = await buildCode({ ...trial, entitlementId: "e2", kind: "paid", expiresAt: farFuture }, testKeyPair.privateKey);
    const promiseB = enrollSignedEntitlement(codeB, "teacher");

    // إثبات صريح متزامن: بمجرد استدعاء B (لا تنفيذه)، الكتابة مرفوضة فورًا
    expect(isWriteAllowedSync("teacher")).toBe(false);

    // نُحرِّر A — ستُكمل استعادتها المركزية (التي كانت ستُعيد true للترخيص الصالح الموجود لولا وجود B معلَّقًا)
    releaseA();
    const resultA = await promiseARealCall;
    expect(resultA.status).toBe("downgrade_rejected");

    // اللحظة مباشرة بعد اكتمال استعادة A: بفضل pendingEnrollmentCount>1 (B لا يزال معلَّقًا فعليًا)،
    // reproveAndSyncCache أجبرت الكاش رجوعًا إلى false رغم أن central verification نفسها أعادت true حقيقيًا
    expect(isWriteAllowedSync("teacher")).toBe(false);

    const resultB = await promiseB;
    expect(resultB.status).toBe("success");
    // فقط بعد اكتمال B (آخر عملية معلَّقة) يُسمَح للكاش بأن يعكس writesAllowed الحقيقية
    expect(isWriteAllowedSync("teacher")).toBe(true);

    readSpy.mockRestore();
  });

  it("FIX3-2) [§6-B3.3، عبر variant مختلف بعد الفصل] Teacher A محتجزة داخل نداء الحفظ نفسه، Director B يُستدعى أثناء ذلك — B لا يُحجَب إطلاقًا الآن (سجلان مستقلان تمامًا، أقفال منفصلة لكل variant)، ينجز بلا انتظار A", async () => {
    const codeA = await buildCode(trial, testKeyPair.privateKey); // Teacher
    const codeB = await buildCode({ ...trial, entitlementId: "e2", kind: "paid", scope: "director" }, testKeyPair.privateKey); // Director

    const realSave = licenseStore.saveVerifiedSignedEntitlement.bind(licenseStore);
    let releaseA: () => void = () => {};
    const gate = new Promise<void>((resolve) => { releaseA = resolve; });
    const callOrder: string[] = [];
    const saveSpy = vi.spyOn(licenseStore, "saveVerifiedSignedEntitlement").mockImplementation(async (code: string, lastSeenAt: string, variant: "teacher" | "director") => {
      callOrder.push(code === codeA ? "teacher-A" : "director-B");
      if (code === codeA) await gate; // Teacher A محتجزة داخل الحفظ نفسه فعليًا
      return realSave(code, lastSeenAt, variant);
    });

    const promiseA = enrollSignedEntitlement(codeA, "teacher");
    await vi.waitFor(() => expect(callOrder).toContain("teacher-A"));

    // PHASE LIC-6D-B-3B.3: بعد فصل الأقفال/الطوابير حسب variant، Director B
    // يدخل منطقة الحفظ الحساسة الخاصة به فورًا، بلا انتظار Teacher A إطلاقًا
    const promiseB = enrollSignedEntitlement(codeB, "director");
    await vi.waitFor(() => expect(callOrder).toContain("director-B"));
    expect(callOrder).toEqual(["teacher-A", "director-B"]); // B دخل فورًا، لم ينتظر A

    releaseA();
    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    expect(resultA.status).toBe("success");
    expect(resultB.status).toBe("success");

    // سجلان مستقلان تمامًا الآن — كلاهما محفوظان بشكل مستقل، صفر تداخل
    const teacherRaw = await readRaw("teacher");
    const directorRaw = await readRaw("director");
    const teacherPayload = JSON.parse(atob(teacherRaw.signedCode.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    const directorPayload = JSON.parse(atob(directorRaw.signedCode.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(teacherPayload.entitlementId).toBe(trial.entitlementId);
    expect(directorPayload.entitlementId).toBe("e2");

    saveSpy.mockRestore();
  });
});

describe("Web Locks API — LIC-6C.1-FIX4", () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true, writable: true });
  });

  it("1) navigator.locks متاح -> مسار Web Lock يُستخدَم فعليًا (قفل variant + قفل هجرة داخلي محتمل، لا عدد ثابت بعد الفصل)", async () => {
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
    expect(requestSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(requestSpy.mock.calls.some((call) => call[0] === "khabir-license-enrollment-current:teacher")).toBe(true);
  });

  it("2) اسم القفل مُدرِك لـvariant الآن (PHASE LIC-6D-B-3B.3: تطور عقد متعمَّد عن اسم ثابت موحَّد سابقًا)", async () => {
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    expect(requestSpy.mock.calls.some((call) => call[0] === "khabir-license-enrollment-current:teacher")).toBe(true);
  });

  it("3) PHASE LIC-6D-B-3B.3 (تطور عقد متعمَّد): Teacher وDirector يستخدمان الآن اسمَي قفل مختلفَين تمامًا (سجلان مستقلان، لا مورد مشترَك بعد الآن)", async () => {
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const codeT = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(codeT, "teacher");
    await resetDatabase();
    const codeD = await buildCode({ ...trial, entitlementId: "e2", scope: "director" }, testKeyPair.privateKey);
    await enrollSignedEntitlement(codeD, "director");

    expect(requestSpy.mock.calls.some((call) => call[0] === "khabir-license-enrollment-current:teacher")).toBe(true);
    expect(requestSpy.mock.calls.some((call) => call[0] === "khabir-license-enrollment-current:director")).toBe(true);
  });

  it("4) navigator.locks غير متاح -> fallback الذاكرة المحلية يعمل بصحة كاملة", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
  });

  it("5) اسم القفل نص ثابت صرف — لا يحتوي signedCode أو أي جزء ديناميكي من المدخل", async () => {
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");
    const lockName = requestSpy.mock.calls[0][0];
    expect(lockName).not.toContain(code.slice(0, 20));
    expect(typeof lockName).toBe("string");
    expect(lockName.length).toBeLessThan(100);
  });

  it("6) رد نداء القفل يحتوي المنطقة الحرجة كاملة فعليًا (التحقق + القرار + الكتابة + الإثبات المركزي، لا مجرد استدعاء فارغ)", async () => {
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
    expect((await readRaw()).signedCode).toBe(code);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });
});

describe("LIC-6C.1-FIX6 §1 — ترتيب القفل قبل البث", () => {
  it("طلب القفل (navigator.locks.request) يُسجَّل قبل بث changing مباشرة، بلا أي فارق زمني يسمح لاسترداد آخر بالتقدم عليه", async () => {
    const callOrder: string[] = [];
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      callOrder.push("lock-requested");
      return callback();
    });
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    // نُموِّه البث نفسه لتسجيل لحظة حدوثه بالنسبة لطلب القفل
    const crossTabModule = await import("./licenseCrossTabSync");
    const notifySpy = vi.spyOn(crossTabModule, "notifyLicenseChanging").mockImplementation(() => { callOrder.push("changing-broadcast"); });

    const code = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code, "teacher");

    // طلب القفل الرئيسي يجب أن يُسجَّل أولًا، ثم البث بعده مباشرة — لا العكس
    // أبدًا. عناصر إضافية بعدهما (قفل الهجرة الجديد يُستدعى داخليًا لاحقًا
    // ضمن قراءات readCurrentState المتعددة أثناء enrollWithinLock نفسها —
    // سلوك صحيح متوقَّع بعد فصل التخزين، لا يخالف الجوهر الأمني المُختبَر هنا).
    expect(callOrder.slice(0, 2)).toEqual(["lock-requested", "changing-broadcast"]);

    notifySpy.mockRestore();
  });
});

describe("LIC-6C.1-FIX6 §3 — إشارة أفضل جهد، صفر throw يفلت", () => {
  it("فشل إنشاء BroadcastChannel لا يُفشِل التسجيل ولا يُبقي أي شيء معلَّقًا", async () => {
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    class ThrowingChannel {
      constructor() { throw new Error("boom: constructor"); }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ThrowingChannel;

    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
  });

  it("فشل postMessage لا يُفشِل التسجيل ولا يُبقي أي شيء معلَّقًا", async () => {
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    class ThrowingPostChannel {
      postMessage() { throw new Error("boom: postMessage"); }
      close() {}
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ThrowingPostChannel;

    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
  });

  it("فشل close لا يُفشِل التسجيل ولا يُبقي أي شيء معلَّقًا", async () => {
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    class ThrowingCloseChannel {
      postMessage() {}
      close() { throw new Error("boom: close"); }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = ThrowingCloseChannel;

    const code = await buildCode(trial, testKeyPair.privateKey);
    const result = await enrollSignedEntitlement(code, "teacher");
    expect(result.status).toBe("success");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
  });

  it("حتى مع فشل الإشارة تمامًا، الاحتجاز المحلي يُحرَّر دائمًا في finally (لا يبقى معلَّقًا للأبد)", async () => {
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    class AlwaysThrowingChannel {
      constructor() { throw new Error("boom"); }
    }
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = AlwaysThrowingChannel;

    const code1 = await buildCode(trial, testKeyPair.privateKey);
    await enrollSignedEntitlement(code1, "teacher");
    // تسجيل ثانٍ لاحق يجب أن يعمل بصحة كاملة — لو كان الاحتجاز الأول عالقًا لفشل هذا
    const code2 = await buildCode({ ...trial, entitlementId: "e2", kind: "paid" }, testKeyPair.privateKey);
    const result2 = await enrollSignedEntitlement(code2, "teacher");
    expect(result2.status).toBe("success");
    expect(isWriteAllowedSync("teacher")).toBe(true);

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
  });
});
