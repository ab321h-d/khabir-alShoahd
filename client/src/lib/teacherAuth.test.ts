import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * بيئة Vitest الافتراضية (Node) لا توفر window/localStorage. teacherAuth.ts
 * يستخدم window.localStorage لتتبّع deviceId وعلامة الجلسة النشطة فقط —
 * polyfill بسيط داخل هذا الملف فقط، لا يضيف أي dependency جديدة، ولا يلمس
 * إعداد Vitest العام للمشروع.
 */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}
(globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage: new MemoryStorage() };
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window.localStorage;
vi.mock("./teacherActivation", () => ({
  verifyTeacherActivation: vi.fn(async (code: string) => {
    if (code === "VALID_TEST_ACTIVATION_CODE") {
      return { ok: true, payload: { version: 1, activationId: "test-activation-id-001", schoolId: "2002", stage: "middle", role: "teacher", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() } };
    }
    return { ok: false, error: "invalid_signature" };
  }),
}));

const { identityStore } = await import("./identityStore");
const { resolveDirectorAccess } = await import("./directorAuth");
const { setupTeacher, verifyTeacherPin, resolveTeacherAccess, lockTeacherSession, getOrCreateTeacherDeviceId } = await import("./teacherAuth");

const resetAllDatabases = () => Promise.all(
  ["khabir-identity-local", "khabir-teacher-credentials-local", "khabir-director-credentials-local"].map(
    (name) => new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    }),
  ),
);

beforeEach(async () => {
  await resetAllDatabases();
  localStorage.clear();
});

describe("setupTeacher — الإعداد الأول بعد تفعيل صالح", () => {
  it("ينشئ هوية معلم بـ role=\"teacher\"", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "أ. نورة القحطاني", pin: "246810", confirmPin: "246810" });
    const identity = await identityStore.getIdentityById(session.userId);
    expect(identity?.role).toBe("teacher");
  });

  it("teacherId يساوي UserIdentity.userId الناتج بالضبط", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم آخر", pin: "111222", confirmPin: "111222" });
    const identity = await identityStore.getIdentityById(session.userId);
    expect(session.userId).toBe(identity?.userId);
  });

  it("activationId (معرّف الدعوة) ليس هو teacherId إطلاقًا", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم ثالث", pin: "333444", confirmPin: "333444" });
    expect(session.userId).not.toBe("test-activation-id-001");
  });

  it("يرفض بيانات اعتماد غير صالحة، ولا يُنشئ أي هوية", async () => {
    await expect(setupTeacher({ activationCredential: "INVALID_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "555555", confirmPin: "555555" })).rejects.toThrow();
    const allTeachers = await identityStore.getIdentitiesByRole("teacher");
    expect(allTeachers.length).toBe(0);
  });
});

describe("verifyTeacherPin — تحقق PIN بعد التفعيل", () => {
  it("PIN الصحيح ينجح ويُعيد جلسة", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    lockTeacherSession();
    const identity = await identityStore.getIdentityById(session.userId);
    const result = await verifyTeacherPin(identity!, "246810");
    expect(result.ok).toBe(true);
  });

  it("PIN الخاطئ يُرفَض", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    lockTeacherSession();
    const identity = await identityStore.getIdentityById(session.userId);
    const result = await verifyTeacherPin(identity!, "000000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_pin");
  });

  it("يدخل cooldown بعد 5 محاولات فاشلة متتالية", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    lockTeacherSession();
    const identity = await identityStore.getIdentityById(session.userId);
    let last;
    for (let i = 0; i < 5; i++) last = await verifyTeacherPin(identity!, "999999");
    expect(last?.ok).toBe(false);
    if (!last?.ok) expect(last?.reason).toBe("cooldown");
  });
});

describe("resolveTeacherAccess — جهاز موثوق واستعادة الجلسة", () => {
  it("جهاز جديد بلا تفعيل سابق = activation-required", async () => {
    const access = await resolveTeacherAccess();
    expect(access.status).toBe("activation-required");
  });

  it("بعد setupTeacher الناجح، resolveTeacherAccess يعيد authenticated فورًا بلا PIN إضافي", async () => {
    await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    const access = await resolveTeacherAccess();
    expect(access.status).toBe("authenticated");
  });

  it("نفس الجهاز يبقى موثوقًا (locked لا activation-required) بعد lock", async () => {
    await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    lockTeacherSession();
    const access = await resolveTeacherAccess();
    expect(access.status).toBe("locked");
  });
});

describe("lock — إنهاء الجلسة دون حذف الهوية", () => {
  it("lockTeacherSession لا يحذف هوية المعلم ولا بيانات اعتماد PIN", async () => {
    const session = await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    lockTeacherSession();
    const identity = await identityStore.getIdentityById(session.userId);
    expect(identity).not.toBeNull();
    const stillWorks = await verifyTeacherPin(identity!, "246810");
    expect(stillWorks.ok).toBe(true);
  });
});

describe("Director isolation — عزل تام عن مصادقة المدير", () => {
  it("resolveDirectorAccess تعمل بشكل مستقل تمامًا ولا تتأثر بإعداد المعلم", async () => {
    await setupTeacher({ activationCredential: "VALID_TEST_ACTIVATION_CODE", schoolId: "2002", stage: "middle", displayName: "معلم", pin: "246810", confirmPin: "246810" });
    const directorAccess = await resolveDirectorAccess();
    expect(directorAccess.status).toBe("activation-required");
  });

  it("deviceId الخاص بالمعلم منفصل تمامًا عن أي شيء يخص المدير (مفتاح localStorage مستقل)", () => {
    const teacherDeviceId = getOrCreateTeacherDeviceId();
    expect(localStorage.getItem("khabir-teacher-device-id")).toBe(teacherDeviceId);
    expect(localStorage.getItem("khabir-director-device-id")).toBeNull();
  });
});
