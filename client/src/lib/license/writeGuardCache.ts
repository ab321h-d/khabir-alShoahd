import type { AppLicenseVariant } from "./licenseTypes";

/**
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 *
 * ذاكرة تخزين مؤقت متزامنة بحالة "الكتابة مسموحة؟" فقط لكل تطبيق (معلم/مدير).
 * معزولة في ملف مستقل عن licenseGuard.ts لتكون قابلة للاختبار مباشرة دون أي
 * اعتماد على IndexedDB أو async. ستُستخدَم لاحقًا (مرحلة ربط مستقبلية منفصلة)
 * لأن autosave الحالي في Home.tsx متزامن تمامًا ولا يمكن تحويله لـ`await`
 * بأمان دون تعديل ذلك الملف — وهذا خارج نطاق PHASE B.5 تحديدًا.
 */
let cachedWriteStatus: { variant: AppLicenseVariant; writesAllowed: boolean } | null = null;

export const setCachedWriteStatus = (variant: AppLicenseVariant, writesAllowed: boolean): void => {
  cachedWriteStatus = { variant, writesAllowed };
};

/** فحص متزامن بلا I/O. متفائل (يسمح) قبل أول تحديث للذاكرة أو لنطاق مختلف. */
export const isWriteAllowedSync = (variant: AppLicenseVariant): boolean => {
  if (!cachedWriteStatus || cachedWriteStatus.variant !== variant) return true;
  return cachedWriteStatus.writesAllowed;
};

/** لأغراض الاختبار فقط: إعادة الذاكرة إلى حالتها الأولية بين الاختبارات. */
export const resetWriteGuardCacheForTests = (): void => {
  cachedWriteStatus = null;
};
