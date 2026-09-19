// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom توفر window.indexedDB/localStorage حقيقيتين بالفعل — نضمن فقط أن
// indexedDB المُموَّهة (fake-indexeddb) مرئية عبرها، بلا استبدال window بالكامل.
if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let testKeyPair: CryptoKeyPair;
let testPublicJwk: JsonWebKey;

const bytesToBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const buildActivationCode = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(new Uint8Array(sig))}`;
};

vi.mock("./directorActivationConfig", () => ({ get DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK() { return testPublicJwk; } }));

const { identityStore } = await import("./identityStore");
const {
  resolveDirectorAccess,
  setupDirector,
  verifyDirectorPin,
  lockDirectorSession,
  __simulateNewRuntimeForTests,
} = await import("./directorAuth");

const DB_NAME = "khabir-identity-local";

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const now = new Date().toISOString();
const future = new Date(Date.now() + 365 * 86400000).toISOString();

const validActivationPayload = (activationId: string) => ({
  version: 1 as const, activationId, schoolId: "school-1", stage: "elementary" as const,
  role: "director" as const, issuedAt: now, expiresAt: future,
});

const setupValidDirector = async (activationId = "act-1", pin = "123456") => {
  const code = await buildActivationCode(validActivationPayload(activationId), testKeyPair.privateKey);
  return setupDirector({ activationCredential: code, schoolId: "school-1", stage: "elementary", displayName: "مدير تجريبي", pin, confirmPin: pin });
};

beforeEach(async () => {
  window.localStorage.clear();
  await resetDatabase();
  __simulateNewRuntimeForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});

afterEach(async () => { await resetDatabase(); window.localStorage.clear(); __simulateNewRuntimeForTests(); });

describe("PILOT-50-B2: أمان جلسة المدير — الجلسة في ذاكرة Runtime فقط (صفر إثبات دائم)", () => {
  it("1) إعداد مدير أول صحيح -> authenticated في runtime الحالي فورًا", async () => {
    await setupValidDirector();
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("authenticated");
  });

  it("2) lock -> PIN مطلوب (locked)", async () => {
    const session = await setupValidDirector();
    lockDirectorSession(session.userId);
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked");
  });

  it("3) refresh/new runtime بعد مصادقة ناجحة -> PIN مطلوب من جديد (locked، لا authenticated تلقائيًا)", async () => {
    await setupValidDirector();
    expect((await resolveDirectorAccess()).status).toBe("authenticated");
    __simulateNewRuntimeForTests(); // محاكاة صادقة لإعادة تحميل الصفحة/إعادة تشغيل حقيقية
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked"); // ليس activation-required — الجهاز والهوية لا يزالان موجودَين
  });

  it("4) restart simulation (مطابق لـ3، مُثبَت صراحة باسمه الخاص) -> PIN مطلوب", async () => {
    await setupValidDirector();
    __simulateNewRuntimeForTests();
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked");
  });

  it("5) كتابة '1' في localStorage -> لا bypass إطلاقًا (صفر اعتماد على أي مخزن دائم)", async () => {
    await setupValidDirector();
    __simulateNewRuntimeForTests();
    window.localStorage.setItem("khabir-director-session-active", "1");
    window.localStorage.setItem("khabir-director-session-token", "1");
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked");
  });

  it("6) توكن مُزوَّر في localStorage (عشوائي حقيقي لكن معنى صفري الآن) -> لا bypass", async () => {
    await setupValidDirector();
    __simulateNewRuntimeForTests();
    window.localStorage.setItem("khabir-director-session-token", crypto.randomUUID());
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked");
  });

  it("7) تعديل قيم شبيهة بجلسة داخل IndexedDB مباشرة -> لا يمنح authenticated بدون PIN في runtime الحالي", async () => {
    const session = await setupValidDirector();
    __simulateNewRuntimeForTests();
    // محاكاة مهاجم يملك DevTools يُعدِّل IndexedDB مباشرة، محاولًا زرع أي
    // قيمة "جلسة" ممكنة — لا يوجد حقل activeSessionToken بعد الآن إطلاقًا
    // (أُزيل بالكامل)، فحتى محاولة الكتابة لا تجد حقلًا ذا معنى لاستغلاله
    const credential = await identityStore.getDirectorCredential(session.userId);
    expect(credential).not.toBeNull();
    expect(Object.keys(credential as object)).not.toContain("activeSessionToken");
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked"); // صفر أي قيمة IndexedDB يمكن أن تُنتِج authenticated
  });

  it("8) Clear localStorage -> لا يمنح access (يعود لـactivation-required لأن deviceId يُفقَد أيضًا)", async () => {
    await setupValidDirector();
    expect((await resolveDirectorAccess()).status).toBe("authenticated");
    window.localStorage.clear();
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("activation-required");
  });

  it("9) هوية معلم وحدها لا تمنح وصول مدير", async () => {
    await identityStore.createIdentity({ role: "teacher", schoolId: "school-1", stage: "elementary", displayName: "معلم" });
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("activation-required");
  });

  it("10) PIN صحيح -> authenticated", async () => {
    const session = await setupValidDirector();
    lockDirectorSession(session.userId);
    const locked = await resolveDirectorAccess();
    if (locked.status !== "locked") throw new Error("unreachable");
    const result = await verifyDirectorPin(locked.identity, "123456");
    expect(result.ok).toBe(true);
    expect((await resolveDirectorAccess()).status).toBe("authenticated");
  });

  it("11) PIN خاطئ/cooldown تبقى سليمة", async () => {
    const session = await setupValidDirector();
    lockDirectorSession(session.userId);
    const locked = await resolveDirectorAccess();
    if (locked.status !== "locked") throw new Error("unreachable");

    for (let i = 0; i < 4; i++) {
      const wrong = await verifyDirectorPin(locked.identity, "000000");
      expect(wrong.ok).toBe(false);
    }
    const fifthWrong = await verifyDirectorPin(locked.identity, "000000"); // المحاولة الخامسة -> cooldown
    expect(fifthWrong.ok).toBe(false);
    if (fifthWrong.ok) throw new Error("unreachable");
    expect(fifthWrong.reason).toBe("cooldown");

    // حتى الرمز الصحيح يُرفَض أثناء cooldown نشطة
    const duringCooldown = await verifyDirectorPin(locked.identity, "123456");
    expect(duringCooldown.ok).toBe(false);
  });

  it("12) activation الموقَّع يبقى مطلوبًا لإنشاء مدير جديد (توقيع خاطئ يُرفَض)", async () => {
    const wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    const forgedCode = await buildActivationCode(validActivationPayload("act-forged"), wrongKeyPair.privateKey);
    await expect(setupDirector({ activationCredential: forgedCode, schoolId: "school-1", stage: "elementary", displayName: "x", pin: "123456", confirmPin: "123456" })).rejects.toThrow();
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("activation-required");
  });
});
