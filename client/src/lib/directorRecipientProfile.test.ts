// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOrCreateDirectorRecipientProfile, CorruptedRecipientProfileError } from "./directorRecipientProfile";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const DB_NAME = "khabir-director-recipient-profile-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

/** يكتب سجلًا مُشوَّهًا مباشرة في القاعدة، متجاوزًا الوحدة تحت الاختبار — لإثبات fail-closed فعليًا. */
const writeRawRecord = (record: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("recipientProfile")) db.createObjectStore("recipientProfile", { keyPath: "key" });
  };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction("recipientProfile", "readwrite");
    tx.objectStore("recipientProfile").put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
  request.onerror = () => reject(request.error);
});

describe("PHASE NEXT-2D-D-B: directorRecipientProfile", () => {
  it("1) أول تهيئة تُنشئ ملفًا صالحًا (recipientId + createdAt)", async () => {
    const profile = await getOrCreateDirectorRecipientProfile();
    expect(typeof profile.recipientId).toBe("string");
    expect(typeof profile.createdAt).toBe("string");
  });

  it("2) recipientId يحمل تمثيل 128+ بت عشوائية (base64url لـ16 بايت خام = 22 حرفًا)", async () => {
    const profile = await getOrCreateDirectorRecipientProfile();
    expect(profile.recipientId.length).toBe(22);
    expect(profile.recipientId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("3) createdAt تاريخ ISO صالح", async () => {
    const profile = await getOrCreateDirectorRecipientProfile();
    expect(Number.isNaN(new Date(profile.createdAt).getTime())).toBe(false);
  });

  it("4) استدعاءات متكررة تُعيد نفس recipientId وnفس createdAt بالضبط", async () => {
    const first = await getOrCreateDirectorRecipientProfile();
    const second = await getOrCreateDirectorRecipientProfile();
    expect(second.recipientId).toBe(first.recipientId);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("5) استمرارية عبر إغلاق/إعادة فتح القاعدة (استدعاء جديد لاحقًا لنفس القاعدة يُعيد نفس الملف)", async () => {
    const first = await getOrCreateDirectorRecipientProfile();
    // استدعاء لاحق منفصل تمامًا (اتصال IndexedDB جديد داخليًا) يُحاكي "إعادة فتح"
    const second = await getOrCreateDirectorRecipientProfile();
    expect(second.recipientId).toBe(first.recipientId);
  });

  it("6) استدعاءات متزامنة (Promise.all) تُحسَم لنفس recipientId ونفس createdAt — صفر سباق", async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateDirectorRecipientProfile(),
      getOrCreateDirectorRecipientProfile(),
      getOrCreateDirectorRecipientProfile(),
    ]);
    expect(a.recipientId).toBe(b.recipientId);
    expect(b.recipientId).toBe(c.recipientId);
    expect(a.createdAt).toBe(b.createdAt);
  });

  it("7) recipientId مُخزَّن بصيغة غير صالحة (طول/محارف خاطئة) يفشل fail-closed", async () => {
    await writeRawRecord({ key: "current", recipientId: "too-short", createdAt: new Date().toISOString() });
    await expect(getOrCreateDirectorRecipientProfile()).rejects.toThrow(CorruptedRecipientProfileError);
  });

  it("8) createdAt مُخزَّن غير صالح (غير قابل للتحليل إطلاقًا) يفشل fail-closed", async () => {
    await writeRawRecord({ key: "current", recipientId: "A".repeat(22), createdAt: "not-a-valid-date" });
    await expect(getOrCreateDirectorRecipientProfile()).rejects.toThrow(CorruptedRecipientProfileError);
  });

  it("8b) [FIX1] createdAt قابل للتحليل عبر Date لكنه غير قانوني (ISO round-trip) يفشل fail-closed — مثال: تاريخ بلا وقت", async () => {
    await writeRawRecord({ key: "current", recipientId: "A".repeat(22), createdAt: "2026-09-23" }); // Date تقبله، لكنه ليس toISOString() القانونية
    await expect(getOrCreateDirectorRecipientProfile()).rejects.toThrow(CorruptedRecipientProfileError);
  });

  it("8c) [FIX1] createdAt المُولَّد فعليًا عبر الوحدة نفسها يمر التحقق القانوني دائمًا", async () => {
    const profile = await getOrCreateDirectorRecipientProfile();
    // نفس الفحص المُطبَّق داخليًا — يجب أن يمر لأنه بالضبط new Date().toISOString()
    const date = new Date(profile.createdAt);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.toISOString()).toBe(profile.createdAt);
  });

  it("9) سجل تالف لا يُعاد توليده صامتًا — استدعاء ثانٍ يفشل بنفس الطريقة، صفر recipientId جديد يظهر", async () => {
    await writeRawRecord({ key: "current", recipientId: "corrupted", createdAt: "invalid" });
    await expect(getOrCreateDirectorRecipientProfile()).rejects.toThrow(CorruptedRecipientProfileError);
    await expect(getOrCreateDirectorRecipientProfile()).rejects.toThrow(CorruptedRecipientProfileError); // صفر "إصلاح" تلقائي عبر استدعاء متكرر
    // تأكيد إضافي: القيمة التالفة نفسها لا تزال في القاعدة، لم تُستبدَل
    const raw = await new Promise<unknown>((resolve) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("recipientProfile", "readonly");
        const getReq = tx.objectStore("recipientProfile").get("current");
        getReq.onsuccess = () => { db.close(); resolve(getReq.result); };
      };
    });
    expect((raw as { recipientId: string }).recipientId).toBe("corrupted");
  });

  it("10) القاعدة لا تحتوي أي مفتاح خاص (فحص بنيوي: صفر ذكر CryptoKey/privateKey في مصدر الملف)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRecipientProfile.ts"), "utf-8");
    expect(source).not.toContain("CryptoKey");
    expect(source).not.toContain("privateKey");
  });

  it("11) القاعدة لا تحتوي schoolId إطلاقًا (فحص بنيوي)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRecipientProfile.ts"), "utf-8");
    expect(source).not.toMatch(/schoolId\s*[:?]/);
  });

  it("12) القاعدة لا تحتوي أي حالة ثقة/تفويض (فحص بنيوي: صفر ذكر directorTrustRegistry/authorization)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRecipientProfile.ts"), "utf-8");
    expect(source).not.toContain("directorTrustRegistry");
    expect(source).not.toMatch(/DirectorAuthorization/);
  });

  it("[ذرية] قراءة+كتابة داخل نفس متغيّر transaction الواحد (فحص بنيوي مباشر)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRecipientProfile.ts"), "utf-8");
    const fnBody = source.slice(source.indexOf("export const getOrCreateDirectorRecipientProfile"));
    const transactionCallCount = (fnBody.match(/database\.transaction\(/g) || []).length;
    expect(transactionCallCount).toBe(1);
  });
});
