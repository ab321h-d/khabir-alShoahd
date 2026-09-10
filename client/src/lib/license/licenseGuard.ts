import { LICENSE_PUBLIC_KEY_JWK } from "./licenseConfig";
import { verifySignedEntitlementCode } from "./licenseCrypto";
import { computeLicenseStatus, computeSignedEntitlementStatus } from "./licenseLogic";
import { licenseStore } from "./licenseStore";
import type { AppLicenseVariant, LicenseStatus } from "./licenseTypes";
import { isWriteAllowedSync, setCachedWriteStatus } from "./writeGuardCache";

export { isWriteAllowedSync } from "./writeGuardCache";

/**
 * PHASE LIC-3/LIC-6B: هذا الملف لم يعد معزولًا — assertWriteAllowed/
 * assertWriteAllowedSync مربوطتان فعليًا بمسارات كتابة حقيقية في
 * directorStore.ts وevidenceStore.ts (منذ LIC-3). التعليق السابق الذي زعم
 * العزل الكامل كان قديمًا وغير دقيق، صُحِّح هنا.
 */

/** يُرمى عند محاولة تنفيذ عملية كتابة/إنشاء ممنوعة بسبب انتهاء التجربة أو الترخيص. */
export class LicenseRestrictedError extends Error {
  constructor(message = "انتهت مدة الاستخدام. جدّد الترخيص للمتابعة في الإنشاء والتعديل.") {
    super(message);
    this.name = "LicenseRestrictedError";
  }
}

/** حالة مرفوضة آمنة، بلا أي قيمة مضلِّلة — تُستخدَم لبيانات اعتماد entitlement فشل تحققها التشفيري، وأيضًا لطلبات قديمة تجاوزها طلب أحدث (لا يجوز أبدًا أن تُفوِّض كتابة). */
const buildDeniedStatus = (nowIso: string): LicenseStatus => ({
  kind: "invalid",
  effectiveNow: nowIso,
  expiresAt: nowIso,
  writesAllowed: false,
  clockRollbackDetected: false,
});

/**
 * PHASE LIC-6B: عدَّاد طلب عالمي واحد (يتوافق مع تصميم writeGuardCache.ts
 * أحادي الفتحة القائم أصلًا — لا خريطة لكل variant). يحمي فقط تحديث الكاش
 * النهائي من طلب أقدم يكتمل متأخرًا بعد طلب أحدث. مستقل تمامًا عن أي عدَّاد
 * في LicenseContext.tsx (الأخير يحمي setStatus فقط، لا علاقة بينهما).
 */
let latestRequestId = 0;

/**
 * يعيد حالة الترخيص الحالية لتطبيق معيّن (معلم أو مدير)، ويحدّث ذاكرة
 * writeGuardCache المتزامنة. قد يُستدعى من أكثر من مصدر متزامن (LicenseContext
 * وحراس كتابة غير متزامنة مستقبلًا) — محمي بعدَّاد "الأحدث يفوز" الخاص به.
 */
export const getCurrentLicenseStatus = async (variant: AppLicenseVariant): Promise<LicenseStatus> => {
  const requestId = ++latestRequestId;
  // PHASE LIC-6B: إصلاح أمني — يُصفَّر الكاش فورًا، قبل أي عمل غير متزامن،
  // لمنع بقاء قيمة "مسموح" قديمة أثناء إعادة تحقق قد تفشل.
  setCachedWriteStatus(variant, false);

  const now = new Date().toISOString();
  const state = await licenseStore.readCurrentState();

  let status: LicenseStatus;

  if (state && state.kind === "entitlement") {
    // PHASE LIC-6B: وجود سجل entitlement (صالحًا أو تالفًا) يمنع الوصول
    // لـ getOrInitializeState نهائيًا — صفر تجربة جديدة تلقائية ممكنة هنا.
    const verification = LICENSE_PUBLIC_KEY_JWK ? await verifySignedEntitlementCode(state.signedCode, LICENSE_PUBLIC_KEY_JWK) : { ok: false as const, error: "malformed" as const };

    if (verification.ok) {
      status = computeSignedEntitlementStatus(verification.payload, state.lastSeenAt, now, variant);
      // touch مسموحة حتى مع نتيجة دلالية سلبية (منتهٍ/نطاق خاطئ) — التوقيع
      // نفسه صحيح، فالوقت المُسجَّل موثوق.
      await licenseStore.touchLastSeen(now);
    } else {
      // فشل تحقق تشفيري: صفر touch، صفر حذف، صفر تجربة جديدة.
      status = buildDeniedStatus(now);
    }
  } else {
    // state === null، أو Legacy (trial/activated) — المسار الحالي بلا أي تغيير دلالي.
    const legacyState = state && (state.kind === "trial" || state.kind === "activated") ? state : await licenseStore.getOrInitializeState(now);
    status = computeLicenseStatus(legacyState, now, variant);
    await licenseStore.touchLastSeen(now);
  }

  // PHASE LIC-6B-FIX2: عدَّاد latestRequestId يحكم ملكية الكاش فقط — لا
  // يجوز أن يُحوِّل النتيجة الحقيقية المحسوبة إلى "invalid" مصطنعة لمجرد أن
  // طلب حراسة آخر بدأ لاحقًا (تدفقا الطلبات في LicenseContext وlicenseGuard
  // منفصلان عمدًا، لا يمثلان نفس التسلسل). الحالة المُعادة دائمًا حقيقية.
  if (requestId === latestRequestId) setCachedWriteStatus(variant, status.writesAllowed);
  return status;
};

/**
 * نقطة الحراسة المركزية غير المتزامنة. مربوطة فعليًا بمسارات كتابة حقيقية
 * في directorStore.ts وevidenceStore.ts (LIC-3).
 *
 * PHASE LIC-6B-FIX2: التفويض يتطلب الاثنين معًا: النتيجة الحقيقية لهذا
 * الطلب تحديدًا (status.writesAllowed) وحالة الكاش المتزامن الحالية
 * (isWriteAllowedSync) في لحظة الحسم. هذا يحمي من نتيجة قديمة true + كاش
 * أحدث false (طلب أحدث رفض أو لا يزال معلَّقًا) بلا تلويث status المُعادة
 * نفسها (تبقى صحيحة تمامًا لعرض الواجهة في LicenseContext).
 */
export const assertWriteAllowed = async (variant: AppLicenseVariant): Promise<void> => {
  const status = await getCurrentLicenseStatus(variant);
  if (!status.writesAllowed || !isWriteAllowedSync(variant)) throw new LicenseRestrictedError();
};

/** نسخة متزامنة من الحراسة (بلا I/O)، لمسارات الكتابة المتزامنة (مثل save() في evidenceStore.ts). */
export const assertWriteAllowedSync = (variant: AppLicenseVariant): void => {
  if (!isWriteAllowedSync(variant)) throw new LicenseRestrictedError();
};
