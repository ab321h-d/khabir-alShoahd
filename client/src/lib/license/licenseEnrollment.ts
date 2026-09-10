import { LICENSE_PUBLIC_KEY_JWK } from "./licenseConfig";
import { verifySignedEntitlementCode } from "./licenseCrypto";
import { computeSignedEntitlementStatus } from "./licenseLogic";
import { licenseStore } from "./licenseStore";
import { getCurrentLicenseStatus } from "./licenseGuard";
import { LICENSE_RESOURCE_LOCK_NAME, createGeneration, notifyLicenseChanged, notifyLicenseChanging } from "./licenseCrossTabSync";
import type { AppLicenseVariant, SignedEntitlementPayload } from "./licenseTypes";
import { acquireWriteDenyHold, releaseWriteDenyHold, setCachedWriteStatus } from "./writeGuardCache";

/**
 * PHASE LIC-6C.1: تسجيل محلي لـ signed entitlement جديد يُدخِله المستخدم
 * يدويًا (لصق كود). لا Backend، لا شبكة — تحقق تشفيري محلي بالكامل، بنفس
 * verifySignedEntitlementCode/computeSignedEntitlementStatus الموجودتين
 * أصلًا في LIC-6A/6B، بلا أي تكرار لمنطقهما.
 *
 * هذه المرحلة لا تحل مشكلة حذف khabir-license-local → تجربة محلية جديدة
 * (LIC-6C وثَّقها كخطر معروف متبقٍّ، يُؤجَّل عمدًا لمرحلة Server Authority).
 */

export type EnrollmentStatus =
  | "success"
  | "invalid"
  | "expired"
  | "wrong_scope"
  | "downgrade_rejected"
  | "persistence_error";

export type EnrollmentResult = { status: EnrollmentStatus };

/** رسائل عربية بسيطة، بلا أي تفصيل تشفيري — للاستخدام المباشر من أي UI مستقبلي. */
export const ENROLLMENT_MESSAGES: Record<EnrollmentStatus, string> = {
  success: "تم تفعيل الترخيص بنجاح.",
  invalid: "رمز التفعيل غير صالح.",
  expired: "انتهت صلاحية رمز التفعيل.",
  wrong_scope: "رمز التفعيل غير مخصص لهذه النسخة.",
  downgrade_rejected: "لا يمكن استبدال الترخيص الحالي بهذا الرمز.",
  persistence_error: "تعذّر حفظ الترخيص. حاول مرة أخرى.",
};

/**
 * PHASE LIC-6C.1-FIX3: قفل تسلسلي (mutex) واحد GLOBAL — لا مقسَّم حسب
 * variant، لأن المورد الحقيقي (سجل IndexedDB الواحد) مشترك بصرف النظر عن
 * الـvariant.
 */
let globalEnrollmentQueue: Promise<unknown> = Promise.resolve();

const runExclusiveGlobal = <T>(task: () => Promise<T>): Promise<T> => {
  const next = globalEnrollmentQueue.then(task, task);
  globalEnrollmentQueue = next.catch(() => undefined);
  return next;
};

/**
 * PHASE LIC-6C.1-FIX4: يلتف حول runExclusiveGlobal بقفل Web Locks API عند
 * توفره — حماية حقيقية عبر التبويبات. عند غياب الدعم: fallback هو طابور
 * الذاكرة المحلي فقط — لا يحمي عبر تبويبات، لا ادّعاء عكس ذلك.
 */
const runExclusiveResource = <T>(task: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) {
    return locks.request(LICENSE_RESOURCE_LOCK_NAME, () => runExclusiveGlobal(task));
  }
  return runExclusiveGlobal(task);
};

/**
 * يُقرِّر: هل يُسمَح باستبدال الحالة الحالية (إن وُجدت) بـentitlement الجديد
 * المُتحقَّق منه بالفعل؟ يُطبِّق مصفوفة السياسات A-H المُقفَلة حرفيًا (LIC-6C.1 §8/§9).
 */
const isReplacementAllowed = async (newPayload: SignedEntitlementPayload): Promise<boolean> => {
  const existingState = await licenseStore.readCurrentState();

  if (!existingState) return true; // A

  if (existingState.kind === "entitlement") {
    const existingVerification = LICENSE_PUBLIC_KEY_JWK ? await verifySignedEntitlementCode(existingState.signedCode, LICENSE_PUBLIC_KEY_JWK) : { ok: false as const, error: "malformed" as const };
    if (!existingVerification.ok) return true; // B

    const existingPayload = existingVerification.payload;
    const now = new Date().toISOString();
    const existingActive = new Date(existingPayload.expiresAt).getTime() > new Date(now).getTime();
    if (!existingActive) return true; // C

    if (existingPayload.kind === "trial" && newPayload.kind === "paid") return true; // D
    if (existingPayload.kind === "trial" && newPayload.kind === "trial") {
      return new Date(newPayload.expiresAt).getTime() >= new Date(existingPayload.expiresAt).getTime(); // E
    }
    if (existingPayload.kind === "paid" && newPayload.kind === "paid") {
      return new Date(newPayload.expiresAt).getTime() >= new Date(existingPayload.expiresAt).getTime(); // F
    }
    if (existingPayload.kind === "paid" && newPayload.kind === "trial") return false; // G
    return false;
  }

  if (existingState.kind === "trial") return true; // Legacy trial

  if (existingState.kind === "activated") return newPayload.kind === "paid"; // Legacy v1 paid

  return false;
};

/**
 * منطقة القرار الحساسة بأكملها — تُنفَّذ دائمًا داخل runExclusiveResource.
 *
 * PHASE LIC-6C.1-FIX6 §2: لا حاجة بعد الآن لإعادة ضبط الكاش يدويًا بعد كل
 * await — احتجاز `local:${generation}` (نشط طوال هذه الدالة كلها، يُحرَّر
 * فقط في finally الخارجية) يضمن أن isWriteAllowedSync تبقى false بصرف
 * النظر عمّا يُثبِته getCurrentLicenseStatus داخليًا للكاش الأساسي.
 */
const enrollWithinLock = async (signedCode: string, variant: AppLicenseVariant): Promise<EnrollmentResult> => {
  const normalizedSignedCode = signedCode.trim();

  const fail = async (status: EnrollmentStatus): Promise<EnrollmentResult> => {
    await getCurrentLicenseStatus(variant); // يُحدِّث الكاش المثبَت فقط؛ الاحتجاز المحلي النشط يمنع كشفه حتى finally
    return { status };
  };

  if (!normalizedSignedCode) return fail("invalid");
  if (!LICENSE_PUBLIC_KEY_JWK) return fail("invalid");

  const verification = await verifySignedEntitlementCode(normalizedSignedCode, LICENSE_PUBLIC_KEY_JWK);
  if (!verification.ok) return fail("invalid");

  const now = new Date().toISOString();
  const freshStatus = computeSignedEntitlementStatus(verification.payload, now, now, variant);

  if (freshStatus.kind === "wrong_scope") return fail("wrong_scope");
  if (!freshStatus.writesAllowed) return fail("expired");

  const allowed = await isReplacementAllowed(verification.payload);
  if (!allowed) return fail("downgrade_rejected");

  const existingRawState = await licenseStore.readCurrentState();
  const priorLastSeenTime = existingRawState && "lastSeenAt" in existingRawState ? new Date(existingRawState.lastSeenAt).getTime() : -Infinity;
  const nowTime = new Date(now).getTime();
  const lastSeenAt = nowTime > priorLastSeenTime ? now : (existingRawState as { lastSeenAt: string }).lastSeenAt;

  try {
    await licenseStore.saveVerifiedSignedEntitlement(normalizedSignedCode, lastSeenAt);
  } catch {
    return fail("persistence_error");
  }

  await getCurrentLicenseStatus(variant);
  return { status: "success" };
};

/**
 * نقطة الدخول الوحيدة لتسجيل entitlement جديد يدويًا. تستقبل signedCode
 * الخام فقط.
 *
 * PHASE LIC-6C.1-FIX6 §1: طلب القفل (locks.request) يجب أن يُسجَّل قبل بث
 * "changing" مباشرة، بلا أي await بينهما — وإلا فقد يسبقنا استرداد تبويب
 * آخر لنفس القفل. runExclusiveResource تستدعي navigator.locks.request(...)
 * بشكل متزامن (التسجيل في طابور المتصفح يحدث فورًا حتى لو لم يُمنَح القفل
 * بعد)، لذا استدعاؤها أولًا ثم البث مباشرة بعدها (بلا await بينهما) يضمن
 * أن طلبنا مسجَّل في الطابور قبل وصول أي إشعار لتبويب آخر بوجود تغيير.
 *
 * PHASE LIC-6C.1-FIX6 §2: احتجاز صلب (`local:${generation}`) يُكتسَب فورًا
 * ومتزامنًا، يُحرَّر فقط في finally — يضمن fail-closed حقيقي بلا أي نافذة
 * عابرة، بديلًا عن pendingEnrollmentCount/فحوصات ما بعد await القديمة.
 */
export const enrollSignedEntitlement = (signedCode: string, variant: AppLicenseVariant): Promise<EnrollmentResult> => {
  setCachedWriteStatus(variant, false);
  const generation = createGeneration();
  acquireWriteDenyHold(`local:${generation}`);

  const enrollmentPromise = runExclusiveResource(() => enrollWithinLock(signedCode, variant));
  // §1: البث يحدث هنا مباشرة — بعد تسجيل طلب القفل أعلاه، بلا await بينهما.
  notifyLicenseChanging(generation);

  return enrollmentPromise.finally(() => {
    releaseWriteDenyHold(`local:${generation}`);
    // §3: إشارة إكمال أفضل جهد دائمًا — بما فيها كل حالات الرفض وأي throw
    // غير متوقَّع؛ finally تضمن هذا بنيويًا.
    notifyLicenseChanged(generation);
  });
};
