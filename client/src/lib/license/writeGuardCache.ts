import type { AppLicenseVariant } from "./licenseTypes";

/**
 * PHASE B.5/LIC-3/LIC-6B: ذاكرة تخزين مؤقت متزامنة بحالة "الكتابة مسموحة؟"
 * فقط لكل تطبيق (معلم/مدير). مربوطة فعليًا بمسارات كتابة حقيقية منذ LIC-3.
 *
 * PHASE LIC-6D-B-3B.3-B3-REAL: إعادة تصميم — حالة مستقلة تمامًا لكل variant
 * عبر خرائط منفصلة، بدل خانة واحدة مُشترَكة {variant, writesAllowed}. قبل
 * هذه المرحلة، تحديث كاش المدير كان يجعل فحص المعلم يفشل تلقائيًا (variant
 * mismatch)، حتى لو حالة المعلم الحقيقية سليمة تمامًا ولم تتغيَّر — اقتران
 * غير ضروري مُصحَّح هنا جذريًا.
 */
const cachedWriteStatusByVariant = new Map<AppLicenseVariant, boolean>();

/**
 * PHASE LIC-6C.1-FIX6 (مُعاد تصميمها هنا لتكون مستقلة لكل variant): آلية
 * احتجاز صلبة (hard deny hold) — تحل مشكلة "النافذة العابرة لـtrue" جذريًا:
 * getCurrentLicenseStatus قد تُحدِّث الكاش إلى true داخليًا في أي لحظة أثناء
 * تنفيذها، لكن طالما يوجد ولو احتجاز واحد نشط لهذا الـvariant تحديدًا
 * (تسجيل محلي معلَّق، جيل remote معلَّق، أو استرداد جارٍ)، isWriteAllowedSync
 * تُعيد false دائمًا لهذا الـvariant وبلا أي استثناء. احتجاز variant واحد
 * لا يؤثر على الآخر إطلاقًا الآن.
 */
const activeDenyHoldsByVariant = new Map<AppLicenseVariant, Set<string>>();

const getHoldsSet = (variant: AppLicenseVariant): Set<string> => {
  let set = activeDenyHoldsByVariant.get(variant);
  if (!set) {
    set = new Set<string>();
    activeDenyHoldsByVariant.set(variant, set);
  }
  return set;
};

/** يُسجِّل احتجازًا نشطًا لـvariant مُحدَّد بمعرّف فريد. Idempotent — نفس المعرّف مرتين لا يُنشئ احتجازين. */
export const acquireWriteDenyHold = (variant: AppLicenseVariant, id: string): void => {
  getHoldsSet(variant).add(id);
};

/** يُزيل احتجازًا بمعرّفه لـvariant مُحدَّد. Idempotent — إزالة معرّف غير موجود لا تفعل شيئًا، بلا خطأ. */
export const releaseWriteDenyHold = (variant: AppLicenseVariant, id: string): void => {
  activeDenyHoldsByVariant.get(variant)?.delete(id);
};

export const setCachedWriteStatus = (variant: AppLicenseVariant, writesAllowed: boolean): void => {
  cachedWriteStatusByVariant.set(variant, writesAllowed);
};

/**
 * فحص متزامن بلا I/O، مستقل تمامًا لكل variant الآن. متشائم (fail-closed)
 * إن لم تُحدَّث الذاكرة بعد لهذا الـvariant تحديدًا، أو إن وُجد أي احتجاز
 * نشط لهذا الـvariant — الاحتجاز يفوز دائمًا. تحديث/احتجاز variant آخر لا
 * يؤثر على هذا الفحص إطلاقًا.
 */
export const isWriteAllowedSync = (variant: AppLicenseVariant): boolean => {
  if ((activeDenyHoldsByVariant.get(variant)?.size ?? 0) > 0) return false;
  const cached = cachedWriteStatusByVariant.get(variant);
  if (cached === undefined) return false;
  return cached;
};

/** لأغراض الاختبار فقط: إعادة الذاكرة (كل variant، كل الاحتجازات) إلى حالتها الأولية بين الاختبارات. */
export const resetWriteGuardCacheForTests = (): void => {
  cachedWriteStatusByVariant.clear();
  activeDenyHoldsByVariant.clear();
};
