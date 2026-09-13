import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivatedLicenseState, LicenseState, TrialLicenseState } from "./licenseTypes";

/**
 * licenseStore.ts يتحقق من `typeof window === "undefined"` قبل لمس
 * IndexedDB. بيئة Vitest الافتراضية (Node) لا توفر window — polyfill بسيط
 * هنا فقط يُشير window.indexedDB لنفس كائن fake-indexeddb العام، بلا أي
 * dependency جديدة ولا تغيير على بيئة Vitest العامة للمشروع.
 */
(globalThis as unknown as { window: { indexedDB: IDBFactory } }).window = { indexedDB: globalThis.indexedDB };

/**
 * PHASE LIC-2B: اختبارات إنتاجية حقيقية على licenseStore.touchLastSeen
 * الفعلية. نُموِّه فقط licenseConfig.ts/licenseLogic.ts (سيبلنغ modules غير
 * مستخدمَين إطلاقًا داخل touchLastSeen نفسها؛ يُستوردان استيرادًا ثابتًا
 * على مستوى الملف فقط لدوال أخرى: activate/getOrInitializeState). البذر
 * الأولي للحالة يتم عبر IndexedDB خام مباشرة (نفس مخطَّط licenseStore.ts
 * الحقيقي: قاعدة "khabir-license-local"، مخزن "state"، مفتاح "current")،
 * لا عبر getOrInitializeState (تفاديًا للحاجة لـcreateInitialTrialState
 * الحقيقية).
 */
vi.mock("./licenseConfig", () => ({ LICENSE_PUBLIC_KEY_JWK: null }));
vi.mock("./licenseLogic", () => ({ createInitialTrialState: vi.fn(), evaluateActivationCode: vi.fn() }));

const { licenseStore } = await import("./licenseStore");

const DB_NAME = "khabir-license-local";
const STORE_NAME = "state";
const RECORD_KEY = "current:teacher";

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const seedState = (state: LicenseState) => new Promise<void>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onupgradeneeded = () => { if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) openRequest.result.createObjectStore(STORE_NAME); };
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const putRequest = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, RECORD_KEY);
    putRequest.onsuccess = () => { db.close(); resolve(); };
    putRequest.onerror = () => { db.close(); reject(putRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

const readRawState = () => new Promise<LicenseState>((resolve, reject) => {
  const openRequest = indexedDB.open(DB_NAME, 1);
  openRequest.onsuccess = () => {
    const db = openRequest.result;
    const getRequest = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(RECORD_KEY);
    getRequest.onsuccess = () => { db.close(); resolve(getRequest.result as LicenseState); };
    getRequest.onerror = () => { db.close(); reject(getRequest.error); };
  };
  openRequest.onerror = () => reject(openRequest.error);
});

const trialState = (lastSeenAt: string): TrialLicenseState => ({ kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt });
const activatedState = (lastSeenAt: string): ActivatedLicenseState => ({ kind: "activated", licenseId: "lic-1", scope: "both", activatedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2027-06-01T00:00:00.000Z", lastSeenAt });

beforeEach(async () => { await resetDatabase(); });

describe("touchLastSeen — lastSeenAt رتيبة، لا تتحرك للخلف أبدًا", () => {
  it("1) forward: 09-09 -> 09-10 => يُحدَّث إلى 09-10", async () => {
    await seedState(trialState("2026-09-09T00:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-10T00:00:00.000Z");
    expect((await readRawState()).lastSeenAt).toBe("2026-09-10T00:00:00.000Z");
  });

  it("2) equal: 09-09 -> 09-09 => يبقى 09-09 (بلا كتابة إضافية مطلوبة)", async () => {
    await seedState(trialState("2026-09-09T00:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-09T00:00:00.000Z");
    expect((await readRawState()).lastSeenAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("3) small rollback: 10:00 -> 09:58 => يبقى 10:00", async () => {
    await seedState(trialState("2026-09-09T10:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-09T09:58:00.000Z");
    expect((await readRawState()).lastSeenAt).toBe("2026-09-09T10:00:00.000Z");
  });

  it("4) large rollback: 09-09 -> 09-01 => يبقى 09-09", async () => {
    await seedState(trialState("2026-09-09T00:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-01T00:00:00.000Z");
    expect((await readRawState()).lastSeenAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("5) repeated rollback: عدة touch بأوقات أقدم متتالية => lastSeenAt لا ينخفض إطلاقًا عبر أي منها", async () => {
    await seedState(trialState("2026-09-09T00:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-05T00:00:00.000Z");
    await licenseStore.touchLastSeen("teacher", "2026-08-01T00:00:00.000Z");
    await licenseStore.touchLastSeen("teacher", "2026-01-01T00:00:00.000Z");
    expect((await readRawState()).lastSeenAt).toBe("2026-09-09T00:00:00.000Z");
  });

  it("6) بقية حقول TrialLicenseState لا تتغيَّر إطلاقًا بسبب touchLastSeen", async () => {
    await seedState(trialState("2026-09-09T00:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-10T00:00:00.000Z");
    const result = await readRawState() as TrialLicenseState;
    expect(result.kind).toBe("trial");
    expect(result.trialStartedAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("7) بقية حقول ActivatedLicenseState (licenseId/scope/activatedAt/expiresAt) تبقى كما هي، فقط lastSeenAt يتحرك للأمام", async () => {
    await seedState(activatedState("2026-09-09T00:00:00.000Z"));
    await licenseStore.touchLastSeen("teacher", "2026-09-10T00:00:00.000Z");
    const result = await readRawState() as ActivatedLicenseState;
    expect(result.kind).toBe("activated");
    expect(result.licenseId).toBe("lic-1");
    expect(result.scope).toBe("both");
    expect(result.activatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(result.expiresAt).toBe("2027-06-01T00:00:00.000Z");
    expect(result.lastSeenAt).toBe("2026-09-10T00:00:00.000Z");

    // rollback بعد التفعيل أيضًا لا يُحرِّك lastSeenAt للخلف
    await licenseStore.touchLastSeen("teacher", "2026-01-01T00:00:00.000Z");
    expect((await readRawState()).lastSeenAt).toBe("2026-09-10T00:00:00.000Z");
  });

  it("8) لا حالة موجودة أصلًا => touchLastSeen لا تُنشئ أي حالة جديدة من تلقاء نفسها", async () => {
    await licenseStore.touchLastSeen("teacher", "2026-09-10T00:00:00.000Z");
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
      request.onsuccess = () => resolve(request.result);
    });
    const record = await new Promise((resolve) => {
      const getRequest = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(RECORD_KEY);
      getRequest.onsuccess = () => resolve(getRequest.result);
    });
    database.close();
    expect(record).toBeUndefined();
  });
});
