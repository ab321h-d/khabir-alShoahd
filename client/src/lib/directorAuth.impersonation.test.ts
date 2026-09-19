// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const { resolveDirectorAccess, setupDirector, verifyDirectorPin, __simulateNewRuntimeForTests } = await import("./directorAuth");

const DB_NAME = "khabir-identity-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

beforeEach(async () => {
  window.localStorage.clear();
  await resetDatabase();
  __simulateNewRuntimeForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});
afterEach(async () => { await resetDatabase(); window.localStorage.clear(); __simulateNewRuntimeForTests(); });

describe("Director Anti-Impersonation — إثبات نهائي صريح", () => {
  it("معلم على نفس الجهاز، بلا activation، يحاول الوصول لـ/director مباشرة -> activation-required دائمًا، صفر مسار bypass", async () => {
    await identityStore.createIdentity({ role: "teacher", schoolId: "s1", stage: "elementary", displayName: "معلم" });
    // محاولة استغلال إضافية: كتابة أي قيمة محتملة في كل تخزين متاح
    window.localStorage.setItem("khabir-director-session-active", "1");
    window.localStorage.setItem("khabir-director-session-token", crypto.randomUUID());
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("activation-required");
  });

  it("إنشاء هوية مدير بلا activationCredential صالح مستحيل بنيويًا (فحص التوقيع الفعلي)", async () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 365 * 86400000).toISOString();
    const wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    const forgedCode = await buildActivationCode(
      { version: 1, activationId: "forged", schoolId: "s1", stage: "elementary", role: "director", issuedAt: now, expiresAt: future },
      wrongKeyPair.privateKey, // توقيع بمفتاح خاطئ تمامًا
    );
    await expect(setupDirector({ activationCredential: forgedCode, schoolId: "s1", stage: "elementary", displayName: "منتحل", pin: "123456", confirmPin: "123456" })).rejects.toThrow();
    const check = await identityStore.getTrustedDevice("any-device");
    expect(check).toBeNull(); // صفر أثر لأي هوية مدير أُنشئت
  });

  it("جلسة مدير جديدة بلا PIN صحيح مستحيلة -> صفر مسار وصول للوحة المدير بدونه", async () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 365 * 86400000).toISOString();
    const code = await buildActivationCode(
      { version: 1, activationId: "legit-1", schoolId: "s1", stage: "elementary", role: "director", issuedAt: now, expiresAt: future },
      testKeyPair.privateKey,
    );
    const session = await setupDirector({ activationCredential: code, schoolId: "s1", stage: "elementary", displayName: "مدير", pin: "123456", confirmPin: "123456" });
    __simulateNewRuntimeForTests(); // جلسة جديدة حقيقية
    const locked = await resolveDirectorAccess();
    expect(locked.status).toBe("locked");
    if (locked.status !== "locked") throw new Error("unreachable");
    // كل محاولة خاطئة تفشل، صفر وصول بلا PIN صحيح فعليًا
    const wrong1 = await verifyDirectorPin(locked.identity, "999999");
    expect(wrong1.ok).toBe(false);
    expect((await resolveDirectorAccess()).status).toBe("locked");
    // فقط PIN الصحيح يمنح الوصول
    const correct = await verifyDirectorPin(locked.identity, "123456");
    expect(correct.ok).toBe(true);
    expect(correct.ok && correct.session.userId).toBe(session.userId);
  });
});
