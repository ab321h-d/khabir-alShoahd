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

/**
 * PHASE LIC-6D-B-3B.3-B1: حالة "لا سلطة محلية كافية" — تُستخدَم حصرًا عند
 * غياب أي حالة ترخيص محلية إطلاقًا (state === null). صفر تجربة جديدة تلقائية
 * — الخادم هو السلطة الوحيدة لبدء/استعادة Trial من الآن فصاعدًا. لا تعني
 * منتهٍ/مُبطَل/تالف — فقط "غياب"، بانتظار recovery flow مستقبلي.
 */
const buildMissingStatus = (nowIso: string): LicenseStatus => ({
  kind: "missing",
  effectiveNow: nowIso,
  expiresAt: nowIso,
  writesAllowed: false,
  clockRollbackDetected: false,
});

/** حالة مرفوضة آمنة، بلا أي قيمة مضلِّلة — تُستخدَم لبيانات اعتماد entitlement فشل تحققها التشفيري، وأيضًا لطلبات قديمة تجاوزها طلب أحدث (لا يجوز أبدًا أن تُفوِّض كتابة). */
const buildDeniedStatus = (nowIso: string): LicenseStatus => ({
  kind: "invalid",
  effectiveNow: nowIso,
  expiresAt: nowIso,
  writesAllowed: false,
  clockRollbackDetected: false,
});

/**
 * PHASE LIC-6D-B-3B.3-B3-REAL-FIX: عدَّاد طلب مستقل **لكل variant** الآن —
 * كان عدَّادًا عالميًا واحدًا مُشترَكًا (يتوافق مع تصميم writeGuardCache.ts
 * القديم أحادي الفتحة)، مما يعني أن طلب director يزيد عدَّادًا يُقارَن به
 * طلب teacher متزامن، فيُهمَل تحديث كاش teacher خطأً رغم عدم وجود أي طلب
 * teacher أحدث فعليًا ينافسه — اقتران cross-variant يخالف عزل B3 مباشرة.
 * الآن كل variant له عدَّاده الخاص المستقل تمامًا، مطابقًا لـwriteGuardCache
 * المُقسَّم فعليًا لكل variant.
 */
const latestRequestIdByVariant = new Map<AppLicenseVariant, number>();

const nextRequestId = (variant: AppLicenseVariant): number => {
  const next = (latestRequestIdByVariant.get(variant) ?? 0) + 1;
  latestRequestIdByVariant.set(variant, next);
  return next;
};

/**
 * يعيد حالة الترخيص الحالية لتطبيق معيّن (معلم أو مدير)، ويحدّث ذاكرة
 * writeGuardCache المتزامنة. قد يُستدعى من أكثر من مصدر متزامن (LicenseContext
 * وحراس كتابة غير متزامنة مستقبلًا) — محمي بعدَّاد "الأحدث يفوز" الخاص به،
 * مستقل تمامًا لكل variant الآن.
 */
export const getCurrentLicenseStatus = async (variant: AppLicenseVariant): Promise<LicenseStatus> => {
  const requestId = nextRequestId(variant);
  // PHASE LIC-6B: إصلاح أمني — يُصفَّر الكاش فورًا، قبل أي عمل غير متزامن،
  // لمنع بقاء قيمة "مسموح" قديمة أثناء إعادة تحقق قد تفشل.
  setCachedWriteStatus(variant, false);

  const now = new Date().toISOString();
  const state = await licenseStore.readCurrentState(variant);

  let status: LicenseStatus;

  if (state && state.kind === "entitlement") {
    // PHASE LIC-6B: وجود سجل entitlement (صالحًا أو تالفًا) يمنع الوصول
    // لـ getOrInitializeState نهائيًا — صفر تجربة جديدة تلقائية ممكنة هنا.
    const verification = LICENSE_PUBLIC_KEY_JWK ? await verifySignedEntitlementCode(state.signedCode, LICENSE_PUBLIC_KEY_JWK) : { ok: false as const, error: "malformed" as const };

    if (verification.ok) {
      status = computeSignedEntitlementStatus(verification.payload, state.lastSeenAt, now, variant);
      // touch مسموحة حتى مع نتيجة دلالية سلبية (منتهٍ/نطاق خاطئ) — التوقيع
      // نفسه صحيح، فالوقت المُسجَّل موثوق.
      await licenseStore.touchLastSeen(variant, now);
    } else {
      // فشل تحقق تشفيري: صفر touch، صفر حذف، صفر تجربة جديدة.
      status = buildDeniedStatus(now);
    }
  } else if (state && (state.kind === "trial" || state.kind === "activated")) {
    // Legacy (trial/activated) موجود فعليًا — المسار الحالي بلا أي تغيير
    // دلالي، مؤكَّد أنه يجب أن يستمر بالعمل (لا كسر توافق legacy في B1).
    status = computeLicenseStatus(state, now, variant);
    await licenseStore.touchLastSeen(variant, now);
  } else {
    // PHASE LIC-6D-B-3B.3-B1: state === null بالضبط — صفر استدعاء لـ
    // getOrInitializeState هنا نهائيًا، صفر تجربة محلية جديدة تُنشَأ أبدًا.
    // هذا هو المسار الوحيد الذي كان يُنشئ trial جديدة تلقائيًا سابقًا —
    // مُغلَق الآن، الخادم هو السلطة الوحيدة لبدء/استعادة Trial.
    status = buildMissingStatus(now);
    // صفر touchLastSeen هنا عمدًا — لا يوجد سجل محلي أصلًا لتحديث وقته.
  }

  // PHASE LIC-6B-FIX2 (مُعاد تصميمها لكل variant في B3-REAL-FIX): عدَّاد
  // requestId يحكم ملكية الكاش فقط لهذا الـvariant تحديدًا — لا يجوز أن
  // يُحوِّل النتيجة الحقيقية المحسوبة إلى "invalid" مصطنعة لمجرد أن طلب
  // حراسة آخر لنفس الـvariant بدأ لاحقًا. الحالة المُعادة دائمًا حقيقية.
  if (requestId === latestRequestIdByVariant.get(variant)) setCachedWriteStatus(variant, status.writesAllowed);
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
