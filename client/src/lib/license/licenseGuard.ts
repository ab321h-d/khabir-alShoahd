import { computeLicenseStatus } from "./licenseLogic";
import { licenseStore } from "./licenseStore";
import type { AppLicenseVariant, LicenseStatus } from "./licenseTypes";
import { isWriteAllowedSync, setCachedWriteStatus } from "./writeGuardCache";

export { isWriteAllowedSync } from "./writeGuardCache";

/**
 * PHASE B.5: ملف معزول تمامًا. لا يستدعيه أي كود في evidenceStore.ts أو
 * directorStore.ts أو Home.tsx أو App.tsx حاليًا. هذه هي "بنية الحراسة"
 * فقط، جاهزة للاستخدام في مرحلة ربط مستقبلية منفصلة (لم تبدأ الآن).
 */

/** يُرمى عند محاولة تنفيذ عملية كتابة/إنشاء ممنوعة بسبب انتهاء التجربة أو الترخيص. */
export class LicenseRestrictedError extends Error {
  constructor(message = "انتهت مدة الاستخدام. جدّد الترخيص للمتابعة في الإنشاء والتعديل.") {
    super(message);
    this.name = "LicenseRestrictedError";
  }
}

/**
 * يعيد حالة الترخيص الحالية لتطبيق معيّن (معلم أو مدير)، ويحدّث ذاكرة
 * writeGuardCache المتزامنة.
 */
export const getCurrentLicenseStatus = async (variant: AppLicenseVariant): Promise<LicenseStatus> => {
  const now = new Date().toISOString();
  const state = await licenseStore.getOrInitializeState(now);
  const status = computeLicenseStatus(state, now, variant);
  await licenseStore.touchLastSeen(now);
  setCachedWriteStatus(variant, status.writesAllowed);
  return status;
};

/**
 * نقطة الحراسة المركزية غير المتزامنة. مصمَّمة لتُستدعى لاحقًا من عمليات
 * كتابة/إنشاء غير متزامنة في تخزين المعلم أو المدير (لم يُربَط شيء بعد).
 */
export const assertWriteAllowed = async (variant: AppLicenseVariant): Promise<void> => {
  const status = await getCurrentLicenseStatus(variant);
  if (!status.writesAllowed) throw new LicenseRestrictedError();
};

/**
 * نسخة متزامنة من الحراسة (بلا I/O)، لمسارات الكتابة المتزامنة (مثل autosave
 * الحالي في Home.tsx) عند الربط المستقبلي.
 */
export const assertWriteAllowedSync = (variant: AppLicenseVariant): void => {
  if (!isWriteAllowedSync(variant)) throw new LicenseRestrictedError();
};
