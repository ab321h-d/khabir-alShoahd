import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivatedLicenseState, SignedEntitlementState, TrialLicenseState } from "./licenseTypes";

(globalThis as unknown as { window: { indexedDB: IDBFactory } }).window = { indexedDB: globalThis.indexedDB };

vi.mock("./licenseConfig", () => ({ LICENSE_PUBLIC_KEY_JWK: null }));
vi.mock("./licenseLogic", () => ({ createInitialTrialState: vi.fn(), evaluateActivationCode: vi.fn() }));

const { licenseStore } = await import("./licenseStore");

const DB_NAME = "khabir-license-local";
const STORE_NAME = "state";
const RECORD_KEY = "current";

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

const seedRaw = (state: unknown) => new Promise<void>((resolve, reject) => {
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

beforeEach(async () => { await resetDatabase(); });

describe("licenseStore.readCurrentState — LIC-6B", () => {
  it("null state -> يعيد null بلا أي تهيئة (لا كتابة جديدة)", async () => {
    const result = await licenseStore.readCurrentState();
    expect(result).toBeNull();
    // تأكيد: لا كتابة حدثت — لا يزال null بعد قراءتين متتاليتين
    const second = await licenseStore.readCurrentState();
    expect(second).toBeNull();
  });

  it("legacy trial -> يُقرأ كما هو حرفيًا", async () => {
    const trial: TrialLicenseState = { kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: "2026-09-09T00:00:00.000Z" };
    await seedRaw(trial);
    const result = await licenseStore.readCurrentState();
    expect(result).toEqual(trial);
  });

  it("legacy activated -> يُقرأ كما هو حرفيًا", async () => {
    const activated: ActivatedLicenseState = { kind: "activated", licenseId: "lic-1", scope: "both", activatedAt: "2026-06-01T00:00:00.000Z", expiresAt: "2027-06-01T00:00:00.000Z", lastSeenAt: "2026-09-09T00:00:00.000Z" };
    await seedRaw(activated);
    const result = await licenseStore.readCurrentState();
    expect(result).toEqual(activated);
  });

  it("entitlement -> يُقرأ كما هو حرفيًا (signedCode الخام، بلا أي تحقق هنا)", async () => {
    const entitlement: SignedEntitlementState = { kind: "entitlement", signedCode: "fake.code", lastSeenAt: "2026-09-09T00:00:00.000Z" };
    await seedRaw(entitlement);
    const result = await licenseStore.readCurrentState();
    expect(result).toEqual(entitlement);
  });

  it("لا يُعدِّل أي بيانات (قراءة متتالية تُعيد نفس المحتوى بلا تغيير)", async () => {
    const trial: TrialLicenseState = { kind: "trial", trialStartedAt: "2026-06-01T00:00:00.000Z", lastSeenAt: "2026-09-09T00:00:00.000Z" };
    await seedRaw(trial);
    await licenseStore.readCurrentState();
    await licenseStore.readCurrentState();
    const result = await licenseStore.readCurrentState();
    expect(result).toEqual(trial);
  });
});
