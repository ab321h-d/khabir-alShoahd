import type { AppLicenseVariant } from "./licenseTypes";

/**
 * PHASE B.5/LIC-3/LIC-6B: ذاكرة تخزين مؤقت متزامنة بحالة "الكتابة مسموحة؟"
 * فقط لكل تطبيق (معلم/مدير). مربوطة فعليًا بمسارات كتابة حقيقية منذ LIC-3.
 */
let cachedWriteStatus: { variant: AppLicenseVariant; writesAllowed: boolean } | null = null;

/**
 * PHASE LIC-6C.1-FIX6: آلية احتجاز صلبة (hard deny hold) — تحل مشكلة
 * "النافذة العابرة لـtrue" جذريًا: getCurrentLicenseStatus قد تُحدِّث
 * cachedWriteStatus إلى true داخليًا في أي لحظة أثناء تنفيذها، لكن طالما
 * يوجد ولو احتجاز واحد نشط (تسجيل محلي معلَّق، جيل remote معلَّق، أو
 * استرداد جارٍ)، isWriteAllowedSync تُعيد false دائمًا وبلا أي استثناء —
 * بصرف النظر تمامًا عن قيمة الكاش المثبَت الأساسية. لا حاجة لإعادة ضبط
 * الكاش يدويًا بعد كل await (نمط قديم يحمل نافذة سباق حقيقية) — الاحتجاز
 * نفسه هو الحاجز، لا التوقيت.
 */
const activeDenyHolds = new Set<string>();

/** يُسجِّل احتجازًا نشطًا بمعرّف فريد. Idempotent — نفس المعرّف مرتين لا يُنشئ احتجازين. */
export const acquireWriteDenyHold = (id: string): void => {
  activeDenyHolds.add(id);
};

/** يُزيل احتجازًا بمعرّفه. Idempotent — إزالة معرّف غير موجود لا تفعل شيئًا، بلا خطأ. */
export const releaseWriteDenyHold = (id: string): void => {
  activeDenyHolds.delete(id);
};

export const setCachedWriteStatus = (variant: AppLicenseVariant, writesAllowed: boolean): void => {
  cachedWriteStatus = { variant, writesAllowed };
};

/**
 * فحص متزامن بلا I/O. متشائم (يمنع/fail-closed) إن لم تُحدَّث الذاكرة بعد
 * لهذا النطاق تحديدًا، أو لنطاق مختلف، أو إن وُجد أي احتجاز نشط — الاحتجاز
 * يفوز دائمًا بصرف النظر عن قيمة الكاش المثبَت.
 */
export const isWriteAllowedSync = (variant: AppLicenseVariant): boolean => {
  if (activeDenyHolds.size > 0) return false;
  if (!cachedWriteStatus || cachedWriteStatus.variant !== variant) return false;
  return cachedWriteStatus.writesAllowed;
};

/** لأغراض الاختبار فقط: إعادة الذاكرة (بما فيها كل الاحتجازات) إلى حالتها الأولية بين الاختبارات. */
export const resetWriteGuardCacheForTests = (): void => {
  cachedWriteStatus = null;
  activeDenyHolds.clear();
};
