import { LICENSE_PUBLIC_KEY_JWK } from "./licenseConfig";
import { verifySignedEntitlementCode } from "./licenseCrypto";
import { createInitialTrialState, evaluateActivationCode } from "./licenseLogic";
import type { ActivationResult, AppLicenseVariant, LicenseScope, LicenseState, PersistedLicenseState } from "./licenseTypes";

/**
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 * (لا `evidenceStore.ts`، لا `directorStore.ts`، لا `Home.tsx`، لا `App.tsx`).
 *
 * قاعدة بيانات مستقلة تمامًا باسم مختلف عن `khabir-alshawahid-local` (تخزين
 * المعلم) و`khabir-director-local` (تخزين المدير). هذا الفصل مقصود ومباشر:
 * حتى بعد الربط لاحقًا (مرحلة مستقبلية منفصلة)، مسارات النسخ الاحتياطي
 * والحذف الحالية لن تفتح هذه القاعدة إطلاقًا ولا تعرف باسمها.
 *
 * PHASE LIC-6D-B-3B.3-B3-REAL: فصل التخزين بين teacher/director — نفس
 * القاعدة/المتجر، مفاتيح منفصلة (current:teacher / current:director) بدل
 * "current" واحد مُشترَك (كان يسمح لتسجيل أحد التطبيقين بتدمير ترخيص
 * الآخر فورًا عبر put مباشر على نفس المفتاح). "current" القديم يُهاجَر
 * تلقائيًا مرة واحدة فقط، ذريًا (قفل هجرة عالمي منفصل عن أقفال variant
 * العادية، لأن teacher/director قد يبدآن التشغيل متزامنَين)، ثم يُحذَف.
 */
const LICENSE_DATABASE_NAME = "khabir-license-local";
const LICENSE_DATABASE_VERSION = 1;
const LICENSE_STORE_NAME = "state";
const LEGACY_LICENSE_RECORD_KEY = "current";

const recordKeyForVariant = (variant: AppLicenseVariant): string => `current:${variant}`;

/** قفل هجرة عالمي واحد — لا variant-aware عمدًا (المفتاح القديم مُشترَك، قد يطالب به المعلم والمدير معًا عند أول تشغيل). */
const LICENSE_LEGACY_MIGRATION_LOCK_NAME = "khabir-license-legacy-current-migration";

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

const readRecordByKey = async (key: string): Promise<PersistedLicenseState | null> => {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  const database = await openLicenseDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readonly").objectStore(LICENSE_STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as PersistedLicenseState | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const writeRecordByKey = async (key: string, state: PersistedLicenseState): Promise<void> => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openLicenseDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readwrite").objectStore(LICENSE_STORE_NAME).put(state, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

const deleteRecordByKey = async (key: string): Promise<void> => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openLicenseDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(LICENSE_STORE_NAME, "readwrite").objectStore(LICENSE_STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

/**
 * يحدِّد الخانة/الخانتين المستهدفتين من scope مُتحقَّق منه (تشفيريًا لو
 * entitlement، أو موثوق من العقد القديم لو legacy activated).
 */
const slotsForScope = (scope: LicenseScope): AppLicenseVariant[] => {
  if (scope === "both") return ["teacher", "director"];
  return [scope];
};

/**
 * PHASE LIC-6D-B-3B.3-B3-REAL: هجرة لمرة واحدة لـ"current" القديم — ذرية
 * عبر قفل هجرة عالمي (لا يعتمد فقط على قفل variant العادي). المعلم والمدير
 * قد يبدآن التشغيل متزامنَين؛ الفائز بالقفل يقرأ "current" (إن وُجد بعد)،
 * يهاجره، يحذفه — الخاسر يجده محذوفًا بالفعل فلا يفعل شيئًا (idempotent،
 * فائز واحد بالضبط لأي مطالبة).
 *
 * سياسات الهجرة المُقفَلة:
 * - entitlement: تحقق تشفيري أولًا؛ فشل ⇒ صفر ثقة، صفر هجرة، لا حذف قسري
 *   للسجل القديم (يبقى، لا كسلطة، فقط دليل تشخيصي محتمل).
 * - entitlement صالح: scope=teacher/director ⇒ خانة واحدة؛ scope=both ⇒
 *   نفس raw signedCode يُنسَخ لكلا الخانتين، خانتان مستقلتان بعدها (لا يعني
 *   هذا نسخ نفس entitlement لـvariant غير مطابق — النسخ هنا فقط لأن
 *   الترخيص الموقَّع نفسه يُصرِّح صراحة بتغطية كلا النطاقين معًا).
 * - legacy activated: نفس منطق scope تمامًا (موثوق من العقد الحالي، بلا
 *   تحقق تشفيري إضافي — لا توقيع تشفيري لهذا الشكل القديم أصلًا).
 * - legacy trial (بلا scope إطلاقًا): يُطالَب به مرة واحدة فقط من أول
 *   variant يُهاجِر فعليًا — لا نسخ مزدوج، لا تمديد، لا تلاعب بالطوابع الزمنية.
 */
const migrateLegacyCurrentIfNeeded = async (variant: AppLicenseVariant): Promise<void> => {
  const doMigration = async (): Promise<void> => {
    const legacy = await readRecordByKey(LEGACY_LICENSE_RECORD_KEY);
    if (!legacy) return; // لا شيء ليُهاجَر — تمت الهجرة بالفعل (فائز سابق) أو لم يوجد أصلًا

    if (legacy.kind === "entitlement") {
      const verification = LICENSE_PUBLIC_KEY_JWK ? await verifySignedEntitlementCode(legacy.signedCode, LICENSE_PUBLIC_KEY_JWK) : { ok: false as const, error: "malformed" as const };
      if (!verification.ok) {
        // مُعبَث به/غير قابل للتحقق: صفر ثقة بـscope منه، صفر هجرة. السجل
        // القديم يبقى كما هو (لا سلطة، دليل تشخيصي محتمل فقط) — لا نحذفه
        // قسرًا هنا لتفادي فقدان أي دليل محتمل بلا داعٍ حقيقي للحذف الآن.
        return;
      }
      for (const slot of slotsForScope(verification.payload.scope)) {
        await writeRecordByKey(recordKeyForVariant(slot), legacy);
      }
      await deleteRecordByKey(LEGACY_LICENSE_RECORD_KEY);
      return;
    }

    if (legacy.kind === "activated") {
      for (const slot of slotsForScope(legacy.scope)) {
        await writeRecordByKey(recordKeyForVariant(slot), legacy);
      }
      await deleteRecordByKey(LEGACY_LICENSE_RECORD_KEY);
      return;
    }

    if (legacy.kind === "trial") {
      // بلا scope إطلاقًا — يُطالَب به مرة واحدة من أول variant يهاجر فعليًا
      await writeRecordByKey(recordKeyForVariant(variant), legacy);
      await deleteRecordByKey(LEGACY_LICENSE_RECORD_KEY);
      return;
    }
  };

  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) {
    await locks.request(LICENSE_LEGACY_MIGRATION_LOCK_NAME, doMigration);
  } else {
    await doMigration();
  }
};

export const licenseStore = {
  /**
   * PHASE LIC-6B: قراءة خام غير مُهيِّئة لهذا الـvariant تحديدًا — تُشغِّل
   * الهجرة من "current" القديم أولًا (مرة واحدة فقط فعليًا عبر القفل)، ثم
   * تقرأ خانة هذا الـvariant المستقلة. صفر تأثير على خانة الـvariant الآخر
   * إطلاقًا. مجرد وجود سجل entitlement (صالح أو تالف) هنا يمنع الوصول إلى
   * getOrInitializeState تمامًا من طرف المستدعي (licenseGuard).
   */
  async readCurrentState(variant: AppLicenseVariant): Promise<PersistedLicenseState | null> {
    await migrateLegacyCurrentIfNeeded(variant);
    return readRecordByKey(recordKeyForVariant(variant));
  },

  /**
   * يعيد حالة الترخيص الحالية لهذا الـvariant، وينشئ حالة تجربة جديدة
   * تلقائيًا إن لم توجد أي حالة سابقة إطلاقًا لهذه الخانة تحديدًا.
   */
  async getOrInitializeState(variant: AppLicenseVariant, nowIso: string = new Date().toISOString()): Promise<LicenseState> {
    const existing = await readRecordByKey(recordKeyForVariant(variant));
    if (existing) {
      // PHASE LIC-6B-FIX: تضييق صريح، لا cast غير آمن يتظاهر بأن entitlement
      // هو LicenseState قديم. لا يجوز أن يحدث هذا فعليًا (licenseGuard.ts لا
      // تستدعي هذه الدالة إطلاقًا عند وجود entitlement)، لكن الدالة نفسها
      // يجب أن تبقى صحيحة النوع بمعزل عن سلوك المستدعي — خطأ صريح بدل كذب نوعي.
      if (existing.kind === "entitlement") {
        throw new Error("getOrInitializeState: لا يجوز استدعاؤها مع وجود entitlement مُخزَّن لهذا الـvariant — استخدم readCurrentState بدلًا منها.");
      }
      return existing;
    }
    const trial = createInitialTrialState(nowIso);
    await writeRecordByKey(recordKeyForVariant(variant), trial);
    return trial;
  },

  /**
   * يحدّث فقط `lastSeenAt` (لرصد تراجع الساعة) دون تغيير أي حقل آخر، لخانة
   * هذا الـvariant. PHASE LIC-2B: `lastSeenAt` لا يجوز أن يتحرك للخلف أبدًا
   * — يُقارَن الوقت الجديد بالوقت المخزَّن فعليًا كطابعَي زمن رقميَّين (لا
   * مقارنة نصية غير موثوقة)، وتُكتَب القيمة فقط إن كانت أحدث فعليًا. تساوٍ
   * أو تراجع = تُبقى القيمة المخزَّنة كما هي، بلا كتابة إطلاقًا.
   */
  async touchLastSeen(variant: AppLicenseVariant, nowIso: string = new Date().toISOString()): Promise<void> {
    const existing = await readRecordByKey(recordKeyForVariant(variant));
    if (!existing) return;
    const nowTime = new Date(nowIso).getTime();
    const existingTime = new Date(existing.lastSeenAt).getTime();
    if (Number.isNaN(nowTime) || nowTime <= existingTime) return;
    await writeRecordByKey(recordKeyForVariant(variant), { ...existing, lastSeenAt: nowIso });
  },

  /**
   * يقيّم كود تفعيل ويحفظه في خانة هذا الـvariant إن كان صالحًا. لا يغيّر
   * أي شيء إن كان الكود غير صالح — الحالة السابقة تبقى كما هي.
   */
  async activate(code: string, variant: AppLicenseVariant, nowIso: string = new Date().toISOString()): Promise<ActivationResult> {
    if (!LICENSE_PUBLIC_KEY_JWK) {
      return { ok: false, error: "لم يُضبط المفتاح العام للترخيص بعد في هذا الإصدار." };
    }
    const result = await evaluateActivationCode(code, LICENSE_PUBLIC_KEY_JWK, variant, nowIso);
    if (result.ok) await writeRecordByKey(recordKeyForVariant(variant), result.state);
    return result;
  },

  /**
   * PHASE LIC-6D-B-3B.3-B1: إعادة ضبط الترخيص — لم تعد تُنشئ تجربة جديدة
   * إطلاقًا (الخادم هو السلطة الوحيدة لبدء Trial الآن). تحذف الحالة المحلية
   * لخانة هذا الـvariant فقط، تاركة النظام في حالة "missing" (صفر سلطة، صفر
   * كتابة) حتى استرداد فعلي مستقبلي. صفر تأثير على خانة الـvariant الآخر.
   */
  async resetLicenseExplicitly(variant: AppLicenseVariant): Promise<null> {
    await deleteRecordByKey(recordKeyForVariant(variant));
    return null;
  },

  /**
   * PHASE LIC-6C.1: تخزين منخفض المستوى لـsignedCode مُتحقَّق منه تشفيريًا
   * بالفعل من طرف المستدعي (licenseEnrollment.ts)، في خانة هذا الـvariant
   * تحديدًا — هذه الدالة نفسها لا تتحقق من شيء ولا تُقرِّر أي منطق
   * ترقية/تنزيل، فقط كتابة ذرية واحدة (put واحد، نفس نمط activate()) لسجل
   * entitlement كامل جديد. القرار الأمني (هل يُسمَح بهذا الاستبدال أصلًا)
   * مسؤولية الطبقة الأعلى حصرًا.
   */
  async saveVerifiedSignedEntitlement(signedCode: string, lastSeenAt: string, variant: AppLicenseVariant): Promise<void> {
    const state: PersistedLicenseState = { kind: "entitlement", signedCode, lastSeenAt };
    await writeRecordByKey(recordKeyForVariant(variant), state);
  },
};
