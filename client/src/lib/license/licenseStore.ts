import { LICENSE_PUBLIC_KEY_JWK } from "./licenseConfig";
import { createInitialTrialState, evaluateActivationCode } from "./licenseLogic";
import type { ActivationResult, AppLicenseVariant, LicenseState } from "./licenseTypes";

/**
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 * (لا `evidenceStore.ts`، لا `directorStore.ts`، لا `Home.tsx`، لا `App.tsx`).
 *
 * قاعدة بيانات مستقلة تمامًا باسم مختلف عن `khabir-alshawahid-local` (تخزين
 * المعلم) و`khabir-director-local` (تخزين المدير). هذا الفصل مقصود ومباشر:
 * حتى بعد الربط لاحقًا (مرحلة مستقبلية منفصلة)، مسارات النسخ الاحتياطي
 * والحذف الحالية لن تفتح هذه القاعدة إطلاقًا ولا تعرف باسمها.
 */
const LICENSE_DATABASE_NAME = "khabir-license-local";
const LICENSE_DATABASE_VERSION = 1;
const LICENSE_STORE_NAME = "state";
const LICENSE_RECORD_KEY = "current";

const openLicenseDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(LICENSE_DATABASE_NAME, LICENSE_DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(LICENSE_STORE_NAME)) {
      request.result.createObjectStore(LICENSE_STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readLicenseState = async (): Promise<LicenseState | null> => {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  const database = await openLicenseDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readonly").objectStore(LICENSE_STORE_NAME).get(LICENSE_RECORD_KEY);
      request.onsuccess = () => resolve((request.result as LicenseState | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const writeLicenseState = async (state: LicenseState): Promise<void> => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openLicenseDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readwrite").objectStore(LICENSE_STORE_NAME).put(state, LICENSE_RECORD_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const deleteLicenseState = async (): Promise<void> => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openLicenseDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readwrite").objectStore(LICENSE_STORE_NAME).delete(LICENSE_RECORD_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

export const licenseStore = {
  /**
   * يعيد حالة الترخيص الحالية، وينشئ حالة تجربة جديدة تلقائيًا إن لم توجد أي
   * حالة سابقة إطلاقًا.
   */
  async getOrInitializeState(nowIso: string = new Date().toISOString()): Promise<LicenseState> {
    const existing = await readLicenseState();
    if (existing) return existing;
    const trial = createInitialTrialState(nowIso);
    await writeLicenseState(trial);
    return trial;
  },

  /** يحدّث فقط `lastSeenAt` (لرصد تراجع الساعة) دون تغيير أي حقل آخر. */
  async touchLastSeen(nowIso: string = new Date().toISOString()): Promise<void> {
    const existing = await readLicenseState();
    if (!existing) return;
    await writeLicenseState({ ...existing, lastSeenAt: nowIso });
  },

  /**
   * يقيّم كود تفعيل ويحفظه إن كان صالحًا. لا يغيّر أي شيء إن كان الكود غير
   * صالح — الحالة السابقة (تجربة أو ترخيص سابق) تبقى كما هي.
   */
  async activate(code: string, variant: AppLicenseVariant, nowIso: string = new Date().toISOString()): Promise<ActivationResult> {
    if (!LICENSE_PUBLIC_KEY_JWK) {
      return { ok: false, error: "لم يُضبط المفتاح العام للترخيص بعد في هذا الإصدار." };
    }
    const result = await evaluateActivationCode(code, LICENSE_PUBLIC_KEY_JWK, variant, nowIso);
    if (result.ok) await writeLicenseState(result.state);
    return result;
  },

  /**
   * إعادة ضبط الترخيص: فعل صريح ومستقل، غير مرتبط بأي مسار "مسح بيانات
   * التطبيق" عادي. يعيد الحالة إلى تجربة جديدة تبدأ الآن.
   */
  async resetLicenseExplicitly(nowIso: string = new Date().toISOString()): Promise<LicenseState> {
    await deleteLicenseState();
    const trial = createInitialTrialState(nowIso);
    await writeLicenseState(trial);
    return trial;
  },
};
