import { LICENSE_PUBLIC_KEY_JWK } from "./licenseConfig";
import { createInitialTrialState, evaluateActivationCode } from "./licenseLogic";
import type { ActivationResult, AppLicenseVariant, LicenseState, PersistedLicenseState } from "./licenseTypes";

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

const readLicenseState = async (): Promise<PersistedLicenseState | null> => {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  const database = await openLicenseDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readonly").objectStore(LICENSE_STORE_NAME).get(LICENSE_RECORD_KEY);
      request.onsuccess = () => resolve((request.result as PersistedLicenseState | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const writeLicenseState = async (state: PersistedLicenseState): Promise<void> => {
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
   * PHASE LIC-6B: قراءة خام غير مُهيِّئة — لا تُنشئ تجربة جديدة، لا تُعدِّل
   * أي شيء، لا تتحقق تشفيريًا. مجرد وجود سجل entitlement (صالح أو تالف) هنا
   * يمنع الوصول إلى getOrInitializeState تمامًا من طرف المستدعي (licenseGuard).
   */
  async readCurrentState(): Promise<PersistedLicenseState | null> {
    return readLicenseState();
  },

  /**
   * يعيد حالة الترخيص الحالية، وينشئ حالة تجربة جديدة تلقائيًا إن لم توجد أي
   * حالة سابقة إطلاقًا.
   */
  async getOrInitializeState(nowIso: string = new Date().toISOString()): Promise<LicenseState> {
    const existing = await readLicenseState();
    if (existing) {
      // PHASE LIC-6B-FIX: تضييق صريح، لا cast غير آمن يتظاهر بأن entitlement
      // هو LicenseState قديم. لا يجوز أن يحدث هذا فعليًا (licenseGuard.ts لا
      // تستدعي هذه الدالة إطلاقًا عند وجود entitlement)، لكن الدالة نفسها
      // يجب أن تبقى صحيحة النوع بمعزل عن سلوك المستدعي — خطأ صريح بدل كذب نوعي.
      if (existing.kind === "entitlement") {
        throw new Error("getOrInitializeState: لا يجوز استدعاؤها مع وجود entitlement مُخزَّن — استخدم readCurrentState بدلًا منها.");
      }
      return existing;
    }
    const trial = createInitialTrialState(nowIso);
    await writeLicenseState(trial);
    return trial;
  },

  /**
   * يحدّث فقط `lastSeenAt` (لرصد تراجع الساعة) دون تغيير أي حقل آخر.
   * PHASE LIC-2B: `lastSeenAt` لا يجوز أن يتحرك للخلف أبدًا — يُقارَن الوقت
   * الجديد بالوقت المخزَّن فعليًا كطابعَي زمن رقميَّين (لا مقارنة نصية غير
   * موثوقة)، وتُكتَب القيمة فقط إن كانت أحدث فعليًا. تساوٍ أو تراجع = تُبقى
   * القيمة المخزَّنة كما هي، بلا كتابة إطلاقًا.
   */
  async touchLastSeen(nowIso: string = new Date().toISOString()): Promise<void> {
    const existing = await readLicenseState();
    if (!existing) return;
    const nowTime = new Date(nowIso).getTime();
    const existingTime = new Date(existing.lastSeenAt).getTime();
    if (Number.isNaN(nowTime) || nowTime <= existingTime) return;
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
