import { LICENSE_PUBLIC_KEY_JWK } from "./licenseConfig";
import { verifySignedEntitlementCode } from "./licenseCrypto";
import { computeLicenseStatus, computeSignedEntitlementStatus } from "./licenseLogic";
import { licenseStore } from "./licenseStore";
import { getCurrentLicenseStatus } from "./licenseGuard";
import { createGeneration, lockNameForVariant, notifyLicenseChanged, notifyLicenseChanging } from "./licenseCrossTabSync";
import type { AppLicenseVariant, SignedEntitlementPayload } from "./licenseTypes";
import { acquireWriteDenyHold, releaseWriteDenyHold, setCachedWriteStatus } from "./writeGuardCache";

/**
 * PHASE LIC-6C.1: تسجيل محلي لـ signed entitlement جديد يُدخِله المستخدم
 * يدويًا (لصق كود). لا Backend، لا شبكة — تحقق تشفيري محلي بالكامل، بنفس
 * verifySignedEntitlementCode/computeSignedEntitlementStatus الموجودتين
 * أصلًا في LIC-6A/6B، بلا أي تكرار لمنطقهما.
 *
 * PHASE LIC-6D-B-3B.3-B3-REAL: بعد فصل التخزين بين teacher/director، كل
 * عمليات هذا الملف مربوطة بخانة الـvariant المستقلة الخاصة بها فقط
 * (current:teacher أو current:director) — صفر تأثير على خانة الـvariant
 * الآخر إطلاقًا في أي مسار هنا.
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
 * PHASE LIC-6C.1-FIX3 (مُعاد تصميمها في B3-REAL): طابور تسلسلي (mutex)
 * منفصل **لكل variant** الآن — بعد فصل التخزين، المورد الحقيقي (خانة
 * IndexedDB) لم يعد مُشترَكًا بين المعلم والمدير، فاستمرار طابور عالمي واحد
 * كان سيُعطِّل تسلسل أحدهما بصمت أثناء عمل الآخر بلا داعٍ حقيقي — اقتران
 * غير ضروري مُصحَّح هنا.
 */
const exclusiveQueueByVariant = new Map<AppLicenseVariant, Promise<unknown>>();

const runExclusiveGlobal = <T>(variant: AppLicenseVariant, task: () => Promise<T>): Promise<T> => {
  const current = exclusiveQueueByVariant.get(variant) ?? Promise.resolve();
  const next = current.then(task, task);
  exclusiveQueueByVariant.set(variant, next.catch(() => undefined));
  return next;
};

/**
 * PHASE LIC-6C.1-FIX4 (مُعاد استخدامها، الآن بقفل مُدرِك لـvariant): يلتف
 * حول runExclusiveGlobal بقفل Web Locks API عند توفره — حماية حقيقية عبر
 * التبويبات، مستقلة تمامًا بين المعلم والمدير الآن. عند غياب الدعم:
 * fallback هو طابور الذاكرة المحلي فقط — لا يحمي عبر تبويبات، لا ادّعاء عكس ذلك.
 */
const runExclusiveResource = <T>(variant: AppLicenseVariant, task: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (locks) {
    return locks.request(lockNameForVariant(variant), () => runExclusiveGlobal(variant, task));
  }
  return runExclusiveGlobal(variant, task);
};

/**
 * يُقرِّر: هل يُسمَح باستبدال الحالة الحالية (إن وُجدت) لهذا الـvariant
 * بـentitlement الجديد المُتحقَّق منه بالفعل؟ يُطبِّق مصفوفة السياسات A-H
 * المُقفَلة حرفيًا (LIC-6C.1 §8/§9)، مقارنة فقط مع خانة هذا الـvariant.
 */
const isReplacementAllowed = async (newPayload: SignedEntitlementPayload, variant: AppLicenseVariant): Promise<boolean> => {
  const existingState = await licenseStore.readCurrentState(variant);

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
 * منطقة القرار الحساسة بأكملها — تُنفَّذ دائمًا داخل runExclusiveResource(variant).
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

  const allowed = await isReplacementAllowed(verification.payload, variant);
  if (!allowed) return fail("downgrade_rejected");

  const existingRawState = await licenseStore.readCurrentState(variant);
  const priorLastSeenTime = existingRawState && "lastSeenAt" in existingRawState ? new Date(existingRawState.lastSeenAt).getTime() : -Infinity;
  const nowTime = new Date(now).getTime();
  const lastSeenAt = nowTime > priorLastSeenTime ? now : (existingRawState as { lastSeenAt: string }).lastSeenAt;

  try {
    await licenseStore.saveVerifiedSignedEntitlement(normalizedSignedCode, lastSeenAt, variant);
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
  acquireWriteDenyHold(variant, `local:${generation}`);

  const enrollmentPromise = runExclusiveResource(variant, () => enrollWithinLock(signedCode, variant));
  // §1: البث يحدث هنا مباشرة — بعد تسجيل طلب القفل أعلاه، بلا await بينهما.
  notifyLicenseChanging(variant, generation);

  return enrollmentPromise.finally(() => {
    releaseWriteDenyHold(variant, `local:${generation}`);
    // §3: إشارة إكمال أفضل جهد دائمًا — بما فيها كل حالات الرفض وأي throw
    // غير متوقَّع؛ finally تضمن هذا بنيويًا.
    notifyLicenseChanged(variant, generation);
  });
};

/**
 * PHASE LIC-6D-B-3B.3-B2-REAL: مصفوفة استبدال مخصَّصة للاسترداد — منفصلة
 * عمدًا عن isReplacementAllowed (التي صُمِّمت لتفعيل يدوي اختياري، لا
 * استرداد سلطوي من الخادم). الفرق الجوهري: existing غير نشط لهذا الـvariant
 * تحديدًا (منتهٍ، أو نطاق خاطئ، أو تالف، أو غائب) → الاسترداد الكنسي يُسمَح
 * دائمًا بصرف النظر عن kind أو نشاط الجديد. existing لا يزال نشطًا لهذا
 * الـvariant تحديدًا → لا يُدمَّر أبدًا بمسترَد غير نشط (مبدأ أمان أدنى
 * صريح)، وإن كان كلاهما نشطًا تُطبَّق نفس مصفوفة D/E/F/G (لـsigned) أو
 * المقارنة المكافئة لـlegacy (trial/activated)، بلا تكرار منطق.
 */
const isRecoveryReplacementAllowed = async (newPayload: SignedEntitlementPayload, newActive: boolean, variant: AppLicenseVariant): Promise<boolean> => {
  const existingState = await licenseStore.readCurrentState(variant);

  if (!existingState) return true; // missing → أي استرداد صالح، نشطًا كان أم منتهيًا

  if (existingState.kind === "entitlement") {
    const existingVerification = LICENSE_PUBLIC_KEY_JWK ? await verifySignedEntitlementCode(existingState.signedCode, LICENSE_PUBLIC_KEY_JWK) : { ok: false as const, error: "malformed" as const };
    if (!existingVerification.ok) return true; // existing تالف → الكنسي المسترَد يحل محله دائمًا

    const existingPayload = existingVerification.payload;
    const now = new Date().toISOString();
    // الحساب المركزي الموثوق نفسه — يشمل فحص scope ضمنيًا (نطاق خاطئ لهذا
    // الـvariant ⇒ writesAllowed=false، تمامًا كأنه غير نشط أصلًا هنا)
    const existingStatusForVariant = computeSignedEntitlementStatus(existingPayload, existingState.lastSeenAt, now, variant);
    const existingActiveForVariant = existingStatusForVariant.writesAllowed;

    if (!existingActiveForVariant) return true; // ليس حقًا نشطًا لهذا الـvariant تحديدًا → الكنسي المسترَد يحل محله دائمًا

    if (!newActive) return false; // مبدأ أمان أدنى صريح: حق نشط لا يُدمَّر أبدًا بمسترَد غير نشط

    // كلاهما نشط لنفس الـvariant — نفس مصفوفة D/E/F/G الأصلية حرفيًا
    if (existingPayload.kind === "trial" && newPayload.kind === "paid") return true;
    if (existingPayload.kind === "trial" && newPayload.kind === "trial") {
      return new Date(newPayload.expiresAt).getTime() >= new Date(existingPayload.expiresAt).getTime();
    }
    if (existingPayload.kind === "paid" && newPayload.kind === "paid") {
      return new Date(newPayload.expiresAt).getTime() >= new Date(existingPayload.expiresAt).getTime();
    }
    if (existingPayload.kind === "paid" && newPayload.kind === "trial") return false;
    return false;
  }

  if (existingState.kind === "trial" || existingState.kind === "activated") {
    // مقارنة حقيقية بمصفوفة D/E/F/G نفسها للحالة القديمة (legacy) — ليست
    // فقط "هل recovered منتهٍ؟" (كانت ستسمح بتنزيل paid→trial أو تقصير مدة
    // trial نشطة بصمت). legacyStatus.expiresAt مصدر الحقيقة الموحَّد لتاريخ
    // انتهاء legacy الفعلي (سواء trial محسوبة أو activated مباشرة).
    const legacyStatus = computeLicenseStatus(existingState, new Date().toISOString(), variant);
    const existingActiveForVariant = legacyStatus.kind === "trial_active" || legacyStatus.kind === "paid_active";

    if (!existingActiveForVariant) return true; // نطاق خاطئ لهذا الـvariant أو منتهٍ أصلًا → الاسترداد يحل محله دائمًا

    if (!newActive) return false; // مبدأ الأمان الأدنى: لا يُدمَّر بمسترَد منتهٍ أبدًا

    const existingIsLegacyPaid = existingState.kind === "activated"; // legacy v1 مُفعَّل = مكافئ paid
    const existingIsLegacyTrial = existingState.kind === "trial";

    if (existingIsLegacyTrial && newPayload.kind === "paid") return true;
    if (existingIsLegacyTrial && newPayload.kind === "trial") {
      return new Date(newPayload.expiresAt).getTime() >= new Date(legacyStatus.expiresAt).getTime();
    }
    if (existingIsLegacyPaid && newPayload.kind === "paid") {
      return new Date(newPayload.expiresAt).getTime() >= new Date(legacyStatus.expiresAt).getTime();
    }
    if (existingIsLegacyPaid && newPayload.kind === "trial") return false;
    return false;
  }

  return false;
};

/**
 * PHASE LIC-6D-B-3B.3-B2-REAL: مسار حفظ منفصل تمامًا لـsignedCode مُسترَد
 * من مصدر backend موثوق مستقبلًا (B4 — لا تنفيذ شبكة هنا إطلاقًا) — يختلف
 * عن enrollWithinLock في نقطة واحدة جوهرية: يسمح بحفظ entitlement منتهية
 * الصلاحية صحيحة تشفيريًا وبنطاق مطابق (Recovery يُميِّز "غائب" عن "معروف
 * لكن منتهٍ" — enrollWithinLock يبقى يرفض expired كما هو تمامًا، صفر تغيير
 * على enrollWithinLock/isReplacementAllowed الأصليتين).
 */
export type RecoveryPersistStatus =
  | "success_active"
  | "success_expired"
  | "invalid"
  | "wrong_scope"
  | "replacement_denied"
  | "persistence_error";

export type RecoveryPersistResult = { status: RecoveryPersistStatus };

const persistRecoveredWithinLock = async (signedCode: string, variant: AppLicenseVariant): Promise<RecoveryPersistResult> => {
  const normalizedSignedCode = signedCode.trim();

  const fail = async (status: RecoveryPersistStatus): Promise<RecoveryPersistResult> => {
    await getCurrentLicenseStatus(variant);
    return { status };
  };

  if (!normalizedSignedCode) return fail("invalid");
  if (!LICENSE_PUBLIC_KEY_JWK) return fail("invalid");

  const verification = await verifySignedEntitlementCode(normalizedSignedCode, LICENSE_PUBLIC_KEY_JWK);
  if (!verification.ok) return fail("invalid");

  const now = new Date().toISOString();
  const freshStatus = computeSignedEntitlementStatus(verification.payload, now, now, variant);

  if (freshStatus.kind === "wrong_scope") return fail("wrong_scope");

  const isActive = freshStatus.writesAllowed;

  const allowed = await isRecoveryReplacementAllowed(verification.payload, isActive, variant);
  if (!allowed) return fail("replacement_denied");

  const existingRawState = await licenseStore.readCurrentState(variant);
  const priorLastSeenTime = existingRawState && "lastSeenAt" in existingRawState ? new Date(existingRawState.lastSeenAt).getTime() : -Infinity;
  const nowTime = new Date(now).getTime();
  const lastSeenAt = nowTime > priorLastSeenTime ? now : (existingRawState as { lastSeenAt: string }).lastSeenAt;

  try {
    await licenseStore.saveVerifiedSignedEntitlement(normalizedSignedCode, lastSeenAt, variant);
  } catch {
    return fail("persistence_error");
  }

  const finalStatus = await getCurrentLicenseStatus(variant);
  return { status: finalStatus.writesAllowed ? "success_active" : "success_expired" };
};

/**
 * نقطة الدخول الوحيدة لحفظ entitlement مُسترَد من backend موثوق مستقبلًا
 * (B4 — لا استدعاء شبكة هنا إطلاقًا). تستقبل signedCode الخام فقط +
 * AppLicenseVariant من سياق التطبيق الموثوق — نفس بنية القفل/الاحتجاز/
 * المزامنة الحالية بالضبط (مُدرِكة لـvariant منذ B3-REAL) — صفر نظام
 * حراسة كتابة ثانٍ، صفر بروتوكول مزامنة جديد.
 */
export const persistRecoveredSignedEntitlement = (signedCode: string, variant: AppLicenseVariant): Promise<RecoveryPersistResult> => {
  setCachedWriteStatus(variant, false);
  const generation = createGeneration();
  acquireWriteDenyHold(variant, `local:${generation}`);

  const persistPromise = runExclusiveResource(variant, () => persistRecoveredWithinLock(signedCode, variant));
  notifyLicenseChanging(variant, generation);

  return persistPromise.finally(() => {
    releaseWriteDenyHold(variant, `local:${generation}`);
    notifyLicenseChanged(variant, generation);
  });
};
