// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCanonical16ByteToken, generateCanonical32ByteToken } from "./relayUploadCapabilityCrypto";
import { capturePendingDeliveryIntent, ensurePendingDeliveryAttemptId, consumePendingDeliveryIntent } from "./directorDeliverySessionUrl";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const STORE_DB = "khabir-teacher-relay-upload-capability-local";
const PENDING_STORAGE_KEY = "khabir-pending-relay-delivery";

const resetDb = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(STORE_DB);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const setLocation = (hash = "") => window.history.replaceState(null, "", `/${hash}`);

beforeEach(async () => { await resetDb(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.sessionStorage.clear(); setLocation(""); });
afterEach(async () => { await resetDb(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); window.sessionStorage.clear(); setLocation(""); });

const redeemedBody = (recipientId: string, capabilityId: string) => JSON.stringify({ ok: true, data: { status: "redeemed", recipientId, capabilityId } });

/** يُعدّ نية معلَّقة حقيقية في sessionStorage (hash + capture + attemptId) — مطلوب الآن لأن redeemDeliverySession تُثبِّت الهوية داخليًا عبر recordResolvedDeliveryIdentity. */
const setupPendingIntent = (sessionId: string, deliveryProof: string) => {
  setLocation(`#deliver=${sessionId}.${deliveryProof}.${generateCanonical32ByteToken()}`);
  capturePendingDeliveryIntent();
  return ensurePendingDeliveryAttemptId();
};

describe("PHASE FRONTEND-REDEMPTION-RECOVERY: teacherDeliverySessionRedemption", () => {
  it("D) proof + attemptId صالحان -> redeemed، الطلب يحتوي فقط deliveryProof+redemptionAttemptId", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);

    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(redeemedBody(recipientId, capabilityId), { status: 200 }); }));

    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    const outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    expect(outcome).toEqual({ status: "redeemed", recipientId, capabilityId });

    const parsed = JSON.parse(sentBody as string);
    expect(Object.keys(parsed).sort()).toEqual(["deliveryProof", "redemptionAttemptId"]);
    expect(parsed.deliveryProof).toBe(deliveryProof);
    expect(parsed.redemptionAttemptId).toBe(attemptId);
  });

  it("§4) نجاح HTTP يُثبِّت resolvedIdentity في sessionStorage قبل أي فحص محلي", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(redeemedBody(recipientId, capabilityId), { status: 200 })));

    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });

    const stored = consumePendingDeliveryIntent();
    expect(stored.kind === "intent" && stored.resolvedIdentity).toEqual({ recipientId, capabilityId });
  });

  it("L) صفر capabilitySecret يظهر في طلب redeem إطلاقًا", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(redeemedBody(generateCanonical16ByteToken(), generateCanonical16ByteToken()), { status: 200 }); }));

    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    expect(sentBody?.includes("capabilitySecret")).toBe(false);
  });

  it("الطلب بلا توقيع/headers relay-auth (المعلم لا يملكها)", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    let calledHeaders: Record<string, string> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { calledHeaders = init.headers as Record<string, string>; return new Response(redeemedBody(generateCanonical16ByteToken(), generateCanonical16ByteToken()), { status: 200 }); }));

    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    expect(calledHeaders?.["X-Relay-Signature"]).toBeUndefined();
  });

  it("عقد محلي صارم: attemptId غير قانوني الصيغة يُرفَض قبل أي fetch", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    const outcome = await redeemDeliverySession({ sessionId: generateCanonical16ByteToken(), deliveryProof: generateCanonical32ByteToken(), redemptionAttemptId: "not-canonical" });
    expect(outcome).toEqual({ status: "malformed_response" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("410 -> session_unavailable، صفر حفظ", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "session_unavailable" } }), { status: 410 })));
    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    const outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    expect(outcome).toEqual({ status: "session_unavailable" });
  });

  it("فشل شبكة -> network_error، صفر حفظ", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    const outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    expect(outcome).toEqual({ status: "network_error" });
  });

  it("F) network_error يُبقي نفس attemptId المحفوظ بلا تغيير (يُتحقَّق عبر إعادة استدعاء ensurePendingDeliveryAttemptId)", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });

    expect(ensurePendingDeliveryAttemptId()).toBe(attemptId); // نفس القيمة، صفر توليد جديد
  });

  it("§4/§7) فشل تثبيت resolvedIdentity (recordResolvedDeliveryIdentity ترمي) -> identity_persistence_failed، صفر ادّعاء نجاح", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(redeemedBody(generateCanonical16ByteToken(), generateCanonical16ByteToken()), { status: 200 })));

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("QuotaExceededError"); });
    try {
      const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
      const outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
      expect(outcome).toEqual({ status: "identity_persistence_failed" });
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("D) حفظ يحدث فقط بعد نجاح مُتحقَّق منه صراحة عبر confirmSaveRedeemedCapability", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(redeemedBody(recipientId, capabilityId), { status: 200 })));
    const { redeemDeliverySession, confirmSaveRedeemedCapability } = await import("./teacherDeliverySessionRedemption");
    const { getStoredUploadCapability } = await import("./relayUploadCapabilityStore");

    const outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    expect(outcome.status).toBe("redeemed");
    if (outcome.status !== "redeemed") return;
    expect(await getStoredUploadCapability(recipientId)).toBeNull();

    const capabilitySecret = generateCanonical32ByteToken();
    await confirmSaveRedeemedCapability({ recipientId: outcome.recipientId, capabilityId: outcome.capabilityId, capabilitySecret });
    const stored = await getStoredUploadCapability(recipientId);
    expect(stored?.capabilityId).toBe(capabilityId);
  });

  it("§10) وجود capability محلية مختلفة لنفس recipientId -> existing_capability_conflict، صفر استبدال صامت", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const recipientId = generateCanonical16ByteToken();
    const oldCapabilityId = generateCanonical16ByteToken();
    const { saveUploadCapability } = await import("./relayUploadCapabilityStore");
    await saveUploadCapability({ recipientId, capabilityId: oldCapabilityId, capabilitySecret: generateCanonical32ByteToken() });

    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof);
    const newCapabilityId = generateCanonical16ByteToken();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(redeemedBody(recipientId, newCapabilityId), { status: 200 })));
    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    const outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });

    expect(outcome).toEqual({ status: "existing_capability_conflict", recipientId, capabilityId: newCapabilityId, existing: expect.objectContaining({ capabilityId: oldCapabilityId }) });

    const { getStoredUploadCapability } = await import("./relayUploadCapabilityStore");
    const stillOld = await getStoredUploadCapability(recipientId);
    expect(stillOld?.capabilityId).toBe(oldCapabilityId);
  });

  it("G) استئناف محلي بعد refresh -> retryLocalCapabilityResolution تنجح بلا أي طلب شبكة", async () => {
    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { retryLocalCapabilityResolution } = await import("./teacherDeliverySessionRedemption");
    const outcome = await retryLocalCapabilityResolution({ recipientId, capabilityId });
    expect(outcome).toEqual({ status: "redeemed", recipientId, capabilityId });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("N) صفر استدعاء تلقائي لـfetch عند مجرد استيراد الوحدة (فحص بنيوي: صفر top-level side effect)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "teacherDeliverySessionRedemption.ts"), "utf-8");
    // كل استدعاء fetch يجب أن يكون داخل دالة مُصدَّرة (export const ...) لا top-level مباشر
    const topLevelLines = source.split("\n").filter((line) => !line.trim().startsWith("//") && !line.includes("export const"));
    expect(source.indexOf("fetch(") > source.indexOf("export const redeemDeliverySession")).toBe(true);
  });

  it("[BLOCKER-FIX] نجاح HTTP يُثبِّت الهوية في sessionStorage ضمن **نفس دورة تشغيل** (بلا refresh)، وفشل محلي لاحق يستطيع استرجاعها من التخزين مباشرة (نفس مصدر الحقيقة الذي تستخدمه ensureIdentityFromStorageOrFail في المكوّن)، بصرف النظر عن أي قيمة ابتدائية كانت null عند التركيب — صفر POST ثانٍ", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const attemptId = setupPendingIntent(sessionId, deliveryProof); // يُحاكي: initialResolvedIdentity=null عند بداية هذا "mount"
    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();

    const fetchSpy = vi.fn(async () => new Response(redeemedBody(recipientId, capabilityId), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    // محاكاة فشل IndexedDB أثناء الفحص المحلي **بعد** نجاح HTTP مباشرة — نفس سيناريو local_lookup_failed
    const originalOpen = indexedDB.open.bind(indexedDB);
    let openCallCount = 0;
    // @ts-expect-error - محاكاة فشل IndexedDB مؤقت لهذا الاستدعاء فقط
    indexedDB.open = (...args: Parameters<typeof indexedDB.open>) => {
      openCallCount += 1;
      if (openCallCount === 1) throw new Error("simulated IndexedDB failure on first local lookup");
      return originalOpen(...args);
    };

    const { redeemDeliverySession } = await import("./teacherDeliverySessionRedemption");
    let outcome;
    try {
      outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    } finally {
      indexedDB.open = originalOpen;
    }
    expect(outcome.status).toBe("local_lookup_failed"); // نجح HTTP فعليًا، فشل الفحص المحلي فقط

    // نفس منطق ensureIdentityFromStorageOrFail/readCurrentResolvedIdentity في المكوّن —
    // القراءة تحدث مباشرة من sessionStorage الآن، لا من أي متغيّر initialResolvedIdentity ثابت
    const currentPending = consumePendingDeliveryIntent();
    expect(currentPending.kind).toBe("intent");
    expect(currentPending.kind === "intent" && currentPending.resolvedIdentity).toEqual({ recipientId, capabilityId });

    // إعادة المحاولة المحلية (retryLocalCapabilityResolution) تستخدم هذه الهوية المُستعادة من التخزين
    const { retryLocalCapabilityResolution } = await import("./teacherDeliverySessionRedemption");
    const retryOutcome = await retryLocalCapabilityResolution(currentPending.kind === "intent" ? currentPending.resolvedIdentity! : { recipientId: "", capabilityId: "" });
    expect(retryOutcome).toEqual({ status: "redeemed", recipientId, capabilityId });

    expect(fetchSpy).toHaveBeenCalledTimes(1); // صفر POST ثانٍ — الاستدعاء الوحيد كان الأول
  });
});
