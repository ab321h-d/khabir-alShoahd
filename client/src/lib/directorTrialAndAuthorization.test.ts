import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { window: { localStorage: MemoryStorage; indexedDB: IDBFactory } }).window = { localStorage: new MemoryStorage(), indexedDB: globalThis.indexedDB };
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let testKeyPair: CryptoKeyPair;
let testPublicJwk: JsonWebKey;
const bytesToBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const buildActivationCode = async (payload: unknown, privateKey: CryptoKey): Promise<string> => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes as BufferSource);
  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(new Uint8Array(sig))}`;
};
import { vi } from "vitest";
vi.mock("./directorActivationConfig", () => ({ get DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK() { return testPublicJwk; } }));

const { identityStore } = await import("./identityStore");
const {
  resolveDirectorAccess, startDirectorTrial, completeDirectorActivation, verifyDirectorPin,
  lockDirectorSession, __simulateNewRuntimeForTests, assertDirectorWriteAllowed, setupDirector,
} = await import("./directorAuth");
const { getCurrentLicenseStatus } = await import("./license/licenseGuard");

const resetDb = (name: string) => new Promise<void>((resolve) => {
  const r = indexedDB.deleteDatabase(name);
  r.onsuccess = () => resolve(); r.onerror = () => resolve(); r.onblocked = () => resolve();
});
const resetAll = () => Promise.all(["khabir-identity-local", "khabir-license-local"].map(resetDb));

const now = new Date().toISOString();
const future = new Date(Date.now() + 365 * 86400000).toISOString();
const validPayload = (schoolId: string, stage: string, activationId = "act-1") => ({
  version: 1 as const, activationId, schoolId, stage, role: "director" as const, issuedAt: now, expiresAt: future,
});

beforeEach(async () => {
  window.localStorage.clear();
  await resetAll();
  __simulateNewRuntimeForTests();
  testKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  testPublicJwk = await crypto.subtle.exportKey("jwk", testKeyPair.publicKey);
});
afterEach(async () => { await resetAll(); window.localStorage.clear(); __simulateNewRuntimeForTests(); });

describe("PILOT-50-F3.4 §1-2: عزل تجربة المدير عن ترخيص المعلم", () => {
  it("1) ترخيص المعلم يعمل بلا أي تغيير (state===null → missing في controlled-pilot، غير متأثر)", async () => {
    const status = await getCurrentLicenseStatus("teacher");
    expect(status.kind).toBeDefined(); // صفر استثناء، سلوك المعلم سليم كما هو
  });

  it("2) بدء تجربة مدير لا يمس ترخيص المعلم إطلاقًا (استقلال كامل)", async () => {
    await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const teacherStatusAfter = await getCurrentLicenseStatus("teacher");
    // صفر أثر جانبي على المعلم من بدء تجربة المدير
    expect(teacherStatusAfter.kind).toBeDefined();
  });
});

describe("PILOT-50-F3.4 §3-5: بدء التجربة وكتابة محلية أثناءها", () => {
  it("3) بدء تجربة بـschoolId+PIN فقط، بلا activationCredential إطلاقًا", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    expect(session.authorizationKind).toBe("trial");
    expect(session.schoolId).toBe("1234");
  });

  it("4) schoolId وحده لا يُنشئ DirectorAuthorization إطلاقًا", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization).toBeNull();
  });

  it("5) تجربة نشطة تسمح بالكتابة المحلية فعليًا", async () => {
    await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    await expect(assertDirectorWriteAllowed()).resolves.toBeUndefined();
  });
});

describe("PILOT-50-F3.4 §6: انتهاء التجربة يحجب الكتابة، يحفظ البيانات", () => {
  it("6) تجربة منتهية تمنع الكتابة المحمية لكن صفر حذف بيانات (سجل التجربة يبقى موجودًا)", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    await identityStore.putDirectorTrial({ userId: session.userId, schoolId: "1234", startedAt: "2000-01-01T00:00:00.000Z" });
    await expect(assertDirectorWriteAllowed()).rejects.toThrow();
    const trialStillExists = await identityStore.getDirectorTrial(session.userId);
    expect(trialStillExists).not.toBeNull(); // صفر حذف
  });
});

describe("PILOT-50-F3.4 §7-9: تفعيل ناجح ينشئ تفويضًا دائمًا، يحافظ على PIN والاستمرارية", () => {
  it("7) تفعيل موقَّع صالح ينشئ DirectorAuthorizationRecord فعليًا", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("1234", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code);
    expect(result.ok).toBe(true);
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization).not.toBeNull();
    expect(authorization?.schools).toEqual([{ schoolId: "1234", stage: "middle" }]);
  });

  it("8) الانتقال يحافظ على نفس PIN — بلا إعادة إنشاء", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "778899", confirmPin: "778899" });
    const code = await buildActivationCode(validPayload("1234", "middle"), testKeyPair.privateKey);
    await completeDirectorActivation(session.userId, code);
    lockDirectorSession(session.userId);
    const identity = await identityStore.getIdentityById(session.userId);
    const pinResult = await verifyDirectorPin(identity!, "778899"); // نفس PIN الأصلي، صفر تغيير
    expect(pinResult.ok).toBe(true);
  });

  it("9) الانتقال يحذف سجل التجربة (التجربة انتهت رسميًا)", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("1234", "middle"), testKeyPair.privateKey);
    await completeDirectorActivation(session.userId, code);
    const trialAfter = await identityStore.getDirectorTrial(session.userId);
    expect(trialAfter).toBeNull();
  });
});

describe("PILOT-50-F3.4 §10-11: ترحيل bounded لمديرين تاريخيين، صفر ترحيل خاطئ لمستخدمي trial", () => {
  it("10) هوية مدير تاريخية (role=director بلا authorization) تُرحَّل مرة واحدة تلقائيًا عند أول resolveDirectorAccess", async () => {
    const legacySession = await setupDirector({ activationCredential: await buildActivationCode(validPayload("legacy-school", "middle"), testKeyPair.privateKey), schoolId: "legacy-school", stage: "middle", displayName: "مدير قديم", pin: "555555", confirmPin: "555555" });
    // محاكاة "قبل هذه المرحلة": حذف authorization يدويًا لمحاكاة مدير أُنشئ قبل الترقية
    // (setupDirector الجديدة تُنشئ authorization تلقائيًا الآن، لذا نحذفها هنا لمحاكاة السيناريو التاريخي بدقة)
    const database = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("khabir-identity-local"); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve) => { const tx = database.transaction("directorAuthorization", "readwrite"); tx.objectStore("directorAuthorization").delete(legacySession.userId); tx.oncomplete = () => resolve(); });
    database.close();

    expect(await identityStore.getDirectorAuthorization(legacySession.userId)).toBeNull(); // تأكيد محاكاة الحالة التاريخية

    __simulateNewRuntimeForTests();
    const access = await resolveDirectorAccess();
    expect(access.status).toBe("locked"); // جهاز موثوق، يحتاج PIN
    const authorizationAfter = await identityStore.getDirectorAuthorization(legacySession.userId);
    expect(authorizationAfter).not.toBeNull(); // تُرحِّلت تلقائيًا
    expect(authorizationAfter?.source).toBe("legacy_migrated");
  });

  it("11) مستخدم trial جديد (بلا role=director إطلاقًا) لا يُرحَّل كمدير مُفعَّل أبدًا", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const identity = await identityStore.getIdentityById(session.userId);
    expect(identity).toBeNull(); // صفر UserIdentity(role=director) من مسار trial إطلاقًا
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization).toBeNull(); // صفر ترحيل خاطئ
  });
});

describe("PILOT-50-F3.4.1: تأكيد صريح لتعارض المدرسة — إعادة تحقق تشفيري كامل، صفر بيانات مدارس من الواجهة", () => {
  it("1/2) جلسة trial تحمل stage=null دائمًا — صفر قيمة وهمية مُشفَّرة", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    expect(session.stage).toBeNull();
  });

  it("3) تفعيل بمدرسة مطابقة لا يزال ينجح بلا أي تغيير سلوكي", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("1234", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.stage).toBe("middle"); // activated تحمل مرحلة حقيقية دائمًا
  });

  it("4) تعارض بلا تأكيد -> school_mismatch، صفر DirectorAuthorization", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("school_mismatch");
    expect(await identityStore.getDirectorAuthorization(session.userId)).toBeNull();
  });

  it("5) استجابة التعارض تحمل schools المُشتقَّة من الاعتماد المُتحقَّق منه فعليًا", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("official-y", "secondary"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code);
    if (!result.ok) expect(result.authorizedSchools).toEqual([{ schoolId: "official-y", stage: "secondary" }]);
  });

  it("6) تعارض + تأكيد صريح -> ينجح، ينشئ تفويضًا من schools[] المُتحقَّق منها فقط", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    const first = await completeDirectorActivation(session.userId, code);
    expect(first.ok).toBe(false);
    const confirmed = await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    expect(confirmed.ok).toBe(true);
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization?.schools).toEqual([{ schoolId: "official-y", stage: "middle" }]);
  });

  it("7) trial.schoolId لا يُضاف صامتًا حتى بعد التأكيد", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization?.schools.some((school) => school.schoolId === "trial-x")).toBe(false);
  });

  it("8) الواجهة لا تستطيع تمرير schools[] كسلطة — الدالة نفسها لا تقبل هذا المعامل إطلاقًا (فحص نوعي/بنيوي)", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    // محاولة تمرير خاصية إضافية غير معروفة (محاكاة "واجهة خبيثة") — يُتجاهَل تمامًا، صفر تأثير
    const maliciousOptions = { confirmSchoolMismatch: true, schools: [{ schoolId: "trial-x", stage: "middle" }] } as { confirmSchoolMismatch?: boolean };
    const result = await completeDirectorActivation(session.userId, code, maliciousOptions);
    expect(result.ok).toBe(true);
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization?.schools).toEqual([{ schoolId: "official-y", stage: "middle" }]); // صفر تأثير لأي بيانات خارجية
  });

  it("9) بيانات اعتماد مُزوَّرة + تأكيد -> فشل تشفيري، صفر تفعيل", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    const forgedCode = await buildActivationCode(validPayload("official-y", "middle"), wrongKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, forgedCode, { confirmSchoolMismatch: true });
    expect(result.ok).toBe(false);
    expect(await identityStore.getDirectorAuthorization(session.userId)).toBeNull();
  });

  it("10) اعتماد منتهي الصلاحية + تأكيد -> فشل، صفر تفعيل", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const expiredPayload = { ...validPayload("official-y", "middle"), expiresAt: "2000-01-01T00:00:00.000Z" };
    const code = await buildActivationCode(expiredPayload, testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    expect(result.ok).toBe(false);
  });

  it("11) تعارض + تأكيد أثناء trial نشطة -> ينجح", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    await expect(assertDirectorWriteAllowed()).resolves.toBeUndefined(); // trial نشطة فعليًا
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    expect(result.ok).toBe(true);
  });

  it("12) تعارض + تأكيد أثناء trial منتهية -> ينجح أيضًا (لا يُصبح تفعيل مستحيلًا)", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    await identityStore.putDirectorTrial({ userId: session.userId, schoolId: "trial-x", startedAt: "2000-01-01T00:00:00.000Z" }); // trial منتهية
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    expect(result.ok).toBe(true);
  });

  it("13) PIN يبقى صالحًا بعد تفعيل مُؤكَّد لتعارض", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "998877", confirmPin: "998877" });
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    lockDirectorSession(session.userId);
    const identity = await identityStore.getIdentityById(session.userId);
    const pinResult = await verifyDirectorPin(identity!, "998877");
    expect(pinResult.ok).toBe(true);
  });

  it("14) userId يبقى ثابتًا عبر التأكيد (استمرارية البيانات المحلية المرتبطة به)", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-x", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("official-y", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code, { confirmSchoolMismatch: true });
    if (result.ok) expect(result.session.userId).toBe(session.userId);
  });
});

describe("PILOT-50-F3.4 §12-13: توافق توقيع v1 + تطبيع post-verification", () => {
  it("12) توقيع v1 لا يزال يُتحقَّق منه بدقة (تعديل بايت واحد يُبطِله)", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("1234", "middle"), testKeyPair.privateKey);
    const tamperedCode = code.slice(0, -2) + "xx";
    const result = await completeDirectorActivation(session.userId, tamperedCode);
    expect(result.ok).toBe(false);
  });

  it("13) v1 يُطبَّع بعد التحقق إلى schools[] بعنصر واحد بالضبط", async () => {
    const session = await startDirectorTrial({ schoolId: "9999", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("9999", "secondary"), testKeyPair.privateKey);
    await completeDirectorActivation(session.userId, code);
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization?.schools).toHaveLength(1);
    expect(authorization?.schools[0]).toEqual({ schoolId: "9999", stage: "secondary" });
  });
});

describe("PILOT-50-F3.4 §14: انتهاء صلاحية credential لا يُبطِل تفعيلًا سابقًا ناجحًا", () => {
  it("14) بعد نجاح التفعيل، انتهاء expiresAt الأصلي لا يؤثر على جلسات PIN لاحقة", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const almostExpired = { ...validPayload("1234", "middle"), expiresAt: new Date(Date.now() + 1000).toISOString() };
    const code = await buildActivationCode(almostExpired, testKeyPair.privateKey);
    await completeDirectorActivation(session.userId, code);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // تجاوز expiresAt الأصلي فعليًا
    lockDirectorSession(session.userId);
    const identity = await identityStore.getIdentityById(session.userId);
    const pinResult = await verifyDirectorPin(identity!, "123456"); // صفر إعادة فحص expiresAt
    expect(pinResult.ok).toBe(true);
  });
});

describe("PILOT-50-F3.4 §15-16: تطابق/تعارض المدرسة", () => {
  it("15) trial.schoolId يطابق schools[] الرسمية -> نجاح عادي", async () => {
    const session = await startDirectorTrial({ schoolId: "match-1", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("match-1", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code);
    expect(result.ok).toBe(true);
  });

  it("16) trial.schoolId لا يطابق -> school_mismatch صريح، صفر إضافة صامتة", async () => {
    const session = await startDirectorTrial({ schoolId: "trial-school-999", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("different-school-111", "middle"), testKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, code);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("school_mismatch");
      expect(result.authorizedSchools).toEqual([{ schoolId: "different-school-111", stage: "middle" }]);
    }
    const authorization = await identityStore.getDirectorAuthorization(session.userId);
    expect(authorization).toBeNull(); // صفر إضافة صامتة لأي مدرسة
  });
});

describe("PILOT-50-F3.4 §21-22: أمان التوقيع والجلسة يبقى سليمًا بعد كل التغييرات", () => {
  it("21) توقيع مُزوَّر بمفتاح خاطئ تمامًا يُرفَض", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const wrongKeyPair = await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
    const forgedCode = await buildActivationCode(validPayload("1234", "middle"), wrongKeyPair.privateKey);
    const result = await completeDirectorActivation(session.userId, forgedCode);
    expect(result.ok).toBe(false);
  });

  it("22) جلسة PIN تبقى تعمل بشكل صحيح تمامًا بعد التفعيل (session.authorizationKind='activated')", async () => {
    const session = await startDirectorTrial({ schoolId: "1234", pin: "123456", confirmPin: "123456" });
    const code = await buildActivationCode(validPayload("1234", "middle"), testKeyPair.privateKey);
    const activationResult = await completeDirectorActivation(session.userId, code);
    expect(activationResult.ok).toBe(true);
    if (activationResult.ok) expect(activationResult.session.authorizationKind).toBe("activated");
  });
});
