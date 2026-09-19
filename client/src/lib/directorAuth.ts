/**
 * PHASE ID-2 + PILOT-50-B2 + PILOT-50-F3.4: تنسيق حماية حساب المدير —
 * إعداد أول مرة (تجربة أو تفعيل موقَّع legacy)، تحقق PIN، جهاز موثوق،
 * جلسة، قفل، ترقية DirectorTrial → DirectorAuthorization. طبقة منطق فوق
 * identityStore.ts + pinCrypto.ts + directorActivation.ts. لا علاقة لها
 * بنظام ترخيص المعلم إطلاقًا (لا استيراد من license/*).
 *
 * تنبيه تصميمي صريح: هذه حماية محلية للاستخدام المدرسي العادي، وليست إثبات
 * هوية رسميًا — لا ضمان تشفيري بلا خادم بأن صاحب الجهاز هو المدير الحقيقي.
 *
 * PHASE PILOT-50-B2: حالة "authenticated" لا تُثبَت أبدًا من أي تخزين
 * دائم — فقط من متغيّر ذاكرة وحدة JS، يُصفَّر تلقائيًا عند أي إعادة تحميل.
 *
 * PHASE PILOT-50-F3.4 — الفصل الأمني الجوهري:
 *   DirectorTrial: تجربة منتج محلية، صفر إثبات هوية، صفر تفويض رسمي.
 *   DirectorAuthorization: التفويض الرسمي الوحيد المعتمَد أمنيًا (تفعيل
 *     موقَّع أو ترحيل legacy مُثبَت من role="director" التاريخية فقط).
 *   صفر مسار يُفسِّر امتلاك DirectorTrial وحده كتفويض رسمي تحت أي ظرف.
 */

import { identityStore, type SchoolStage, type UserIdentity, type AuthorizedSchool, type DirectorAuthorizationRecord } from "./identityStore";
import { derivePinCredential, isValidPinFormat, verifyPinCredential } from "./pinCrypto";
import { verifyDirectorActivation, verifyDirectorActivationCredential, normalizeActivationPayloadToSchools } from "./directorActivation";
import { isDirectorTrialExpired } from "./directorTrialPolicy";

export type DirectorSession = {
  userId: string;
  role: "director";
  /** المدرسة/المرحلة النشطة حاليًا (أول مدرسة مُخوَّلة، أو مدرسة التجربة). */
  schoolId: string;
  /**
   * PHASE PILOT-50-F3.4.1: قد تكون null فقط لحالة trial (صفر مرحلة حقيقية
   * معروفة/مُتحقَّق منها بعد) — **لا قيمة وهمية مُشفَّرة كصحيحة إطلاقًا**.
   * حالة activated تحمل دائمًا SchoolStage حقيقية من authorization.schools[0].
   */
  stage: SchoolStage | null;
  deviceId: string;
  authenticatedAt: string;
  /** PHASE PILOT-50-F3.4: الفصل الأمني الظاهر في الجلسة نفسها — لا التباس ممكن. */
  authorizationKind: "trial" | "activated";
  /** فارغة دائمًا لحالة trial — المدارس المُخوَّلة رسميًا فقط لحالة activated. */
  schools: AuthorizedSchool[];
};

export type DirectorAccessState =
  | { status: "loading" }
  | { status: "activation-required" }
  | { status: "locked"; identity: UserIdentity; cooldownUntil: string | null; authorizationKind: "trial" | "activated" }
  | { status: "authenticated"; session: DirectorSession }
  | { status: "trial_expired"; userId: string };

export type VerifyPinResult =
  | { ok: true; session: DirectorSession }
  | { ok: false; reason: "invalid_pin" | "cooldown" | "disabled" | "trial_expired"; cooldownUntil?: string };

export type CompleteActivationResult =
  | { ok: true; session: DirectorSession }
  | { ok: false; reason: "invalid_credential" | "school_mismatch"; error?: string; authorizedSchools?: AuthorizedSchool[] };

const DEVICE_ID_STORAGE_KEY = "khabir-director-device-id";

const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

/**
 * PHASE PILOT-50-B2: مصدر الحقيقة الوحيد لحالة "مُصادَق عليه الآن" —
 * متغيّر ذاكرة وحدة JS بحت، صفر تخزين دائم من أي نوع.
 */
let runtimeAuthenticatedUserId: string | null = null;

/** deviceId عشوائي دائم لهذا المتصفح/التثبيت — لا fingerprinting، لا ربط بعتاد الجهاز. */
export const getOrCreateDeviceId = (): string => {
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
};

const buildActivatedSession = (identity: UserIdentity, deviceId: string, authorization: DirectorAuthorizationRecord): DirectorSession => ({
  userId: identity.userId,
  role: "director",
  schoolId: authorization.schools[0]?.schoolId ?? identity.schoolId,
  stage: authorization.schools[0]?.stage ?? identity.stage,
  deviceId,
  authenticatedAt: new Date().toISOString(),
  authorizationKind: "activated",
  schools: authorization.schools,
});

const buildTrialSession = (userId: string, schoolId: string, deviceId: string): DirectorSession => ({
  userId,
  role: "director",
  schoolId,
  stage: null, // PHASE PILOT-50-F3.4.1: صفر قيمة وهمية مُشفَّرة كصحيحة — trial لا تملك مرحلة مُتحقَّق منها
  deviceId,
  authenticatedAt: new Date().toISOString(),
  authorizationKind: "trial",
  schools: [],
});

/**
 * PHASE PILOT-50-F3.4: ترحيل bounded لمديرين تاريخيين — role="director"
 * كانت (قبل هذه المرحلة) تُنشَأ **حصرًا** عبر setupDirector بعد تفعيل
 * موقَّع ناجح (مُثبَت بحثًا شاملًا في التدقيق: مسار كتابة وحيد في كل
 * المشروع). هذا يجعلها دليل ترحيل تاريخي كافٍ — **قاعدة توافق خلفي
 * محدودة فقط**، لا قاعدة تفويض دائمة: تُنفَّذ مرة واحدة فقط (عند غياب
 * DirectorAuthorizationRecord فعليًا)، ولا تُستخدَم أبدًا لإنشاء تفويض
 * لمستخدمي trial الجدد (الذين لا يملكون UserIdentity(role="director") أصلًا).
 */
const migrateLegacyDirectorIfNeeded = async (identity: UserIdentity): Promise<DirectorAuthorizationRecord> => {
  const existing = await identityStore.getDirectorAuthorization(identity.userId);
  if (existing) return existing;

  const migrated: DirectorAuthorizationRecord = {
    userId: identity.userId,
    source: "legacy_migrated",
    schools: [{ schoolId: identity.schoolId, stage: identity.stage }],
    authorizedAt: identity.createdAt,
  };
  await identityStore.putDirectorAuthorization(migrated);
  return migrated;
};

/**
 * يحسم حالة الوصول الحالية دون طلب أي تفاعل من المستخدم.
 *
 * PHASE PILOT-50-F3.4: يميز بين ثلاثة مصادر ممكنة بعد إيجاد جهاز موثوق:
 *   1) UserIdentity(role="director") موجودة → activated (مع ترحيل legacy تلقائي bounded عند الحاجة)
 *   2) DirectorTrialRecord موجود → trial (مع فحص انتهاء صريح)
 *   3) لا شيء → activation-required
 */
export const resolveDirectorAccess = async (): Promise<DirectorAccessState> => {
  const deviceId = getOrCreateDeviceId();
  const device = await identityStore.getTrustedDevice(deviceId);
  if (!device) return { status: "activation-required" };

  const identity = await identityStore.getIdentityById(device.userId);
  if (identity && identity.role === "director" && identity.status === "active") {
    const authorization = await migrateLegacyDirectorIfNeeded(identity);

    if (runtimeAuthenticatedUserId === identity.userId) {
      return { status: "authenticated", session: buildActivatedSession(identity, deviceId, authorization) };
    }
    const credential = await identityStore.getDirectorCredential(identity.userId);
    const cooldownUntil = credential?.lockUntil && new Date(credential.lockUntil).getTime() > Date.now() ? credential.lockUntil : null;
    return { status: "locked", identity, cooldownUntil, authorizationKind: "activated" };
  }

  const trial = await identityStore.getDirectorTrial(device.userId);
  if (trial) {
    if (isDirectorTrialExpired(trial.startedAt)) {
      if (runtimeAuthenticatedUserId === trial.userId) return { status: "trial_expired", userId: trial.userId };
      // لا يزال يحتاج PIN حتى لعرض حالة "منتهية" — صفر كشف معلومات بلا مصادقة
    }
    if (runtimeAuthenticatedUserId === trial.userId && !isDirectorTrialExpired(trial.startedAt)) {
      return { status: "authenticated", session: buildTrialSession(trial.userId, trial.schoolId, deviceId) };
    }
    const credential = await identityStore.getDirectorCredential(trial.userId);
    const cooldownUntil = credential?.lockUntil && new Date(credential.lockUntil).getTime() > Date.now() ? credential.lockUntil : null;
    // PHASE PILOT-50-F3.4: locked تتطلب identity — trial لا تملك UserIdentity حقيقية،
    // نبني تمثيلًا محايدًا كافيًا لواجهة PIN فقط (صفر استخدام أمني لهذه القيمة).
    const trialPseudoIdentity: UserIdentity = { userId: trial.userId, role: "director", schoolId: trial.schoolId, stage: "elementary", displayName: "", createdAt: trial.startedAt, updatedAt: trial.startedAt, status: "active" };
    return { status: "locked", identity: trialPseudoIdentity, cooldownUntil, authorizationKind: "trial" };
  }

  return { status: "activation-required" };
};

/**
 * PHASE PILOT-50-F3.4 — الشاشة الأولى الجديدة: رقم وزاري + PIN فقط، صفر
 * activationCredential، صفر اسم مدير، صفر اختيار مرحلة. الرقم الوزاري
 * **بيانات تجربة فقط** — صفر إثبات هوية، صفر إنشاء UserIdentity(role="director").
 */
export const startDirectorTrial = async (input: { schoolId: string; pin: string; confirmPin: string }): Promise<DirectorSession> => {
  const schoolId = input.schoolId.trim();
  if (!schoolId) throw new Error("الرجاء إدخال الرقم الوزاري");
  if (!isValidPinFormat(input.pin)) throw new Error("صيغة PIN غير صالحة");
  if (input.pin !== input.confirmPin) throw new Error("PIN وتأكيده غير متطابقين");

  const userId = crypto.randomUUID?.() || `dtrial-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const startedAt = new Date().toISOString();
  await identityStore.putDirectorTrial({ userId, schoolId, startedAt });

  const credential = await derivePinCredential(input.pin);
  await identityStore.putDirectorCredential({ ...credential, userId, failedAttempts: 0, lockUntil: null, updatedAt: startedAt });

  const deviceId = getOrCreateDeviceId();
  await identityStore.registerTrustedDevice(deviceId, userId);
  runtimeAuthenticatedUserId = userId;

  return buildTrialSession(userId, schoolId, deviceId);
};

/**
 * PHASE PILOT-50-F3.4 — انتقال DirectorTrial → DirectorAuthorization.
 * يُستدعى من داخل workspace التجربة (المستخدم مُصادَق عليه بالفعل).
 * يحافظ على نفس userId (عبر createIdentityWithId) → DirectorCredentialRecord
 * (PIN) يبقى صالحًا تلقائيًا بلا أي إعادة كتابة، صفر إعادة onboarding،
 * صفر فقدان بيانات محلية (directorStore منفصلة تمامًا، غير متأثرة).
 *
 * PHASE PILOT-50-F3.4/§M: trial.schoolId يُطابَق صراحة مع schools[] الرسمية
 * — صفر إضافة صامتة لمدرسة trial غير مُخوَّلة. عدم التطابق يُعيد
 * "school_mismatch" مع قائمة المدارس المُخوَّلة الفعلية، للمستخدم ليقرر صراحة.
 */
/**
 * PHASE PILOT-50-F3.4.1 — تصحيح جوهري: confirmSchoolMismatch **إشارة نية
 * boolean فقط** — لا تحمل أبدًا قائمة مدارس من طرف الواجهة. عند كل
 * استدعاء (أول محاولة أو تأكيد لاحق)، الدالة تُعيد التحقق التشفيري الكامل
 * من activationCredential نفسه من الصفر، وتشتق schools[] من نتيجة هذا
 * التحقق **الطازج نفسه فقط** — الواجهة لا تستطيع أبدًا توسيع نطاق التفويض
 * لأنها لا تُمرِّر أي بيانات مدارس إطلاقًا، فقط نية "أوافق على المتابعة
 * بما تحقَّق منه النظام تشفيريًا".
 */
export const completeDirectorActivation = async (userId: string, activationCredential: string, options: { confirmSchoolMismatch?: boolean } = {}): Promise<CompleteActivationResult> => {
  const trial = await identityStore.getDirectorTrial(userId);

  // إعادة التحقق التشفيري الكامل من جديد — دائمًا، في كل استدعاء، بلا استثناء.
  const activationResult = await verifyDirectorActivationCredential(activationCredential);
  if (!activationResult.ok) return { ok: false, reason: "invalid_credential", error: activationResult.error };

  const schools = normalizeActivationPayloadToSchools(activationResult.payload);

  if (trial) {
    const matches = schools.some((school) => school.schoolId === trial.schoolId);
    if (!matches && options.confirmSchoolMismatch !== true) {
      return { ok: false, reason: "school_mismatch", authorizedSchools: schools };
    }
    // matches===false && confirmSchoolMismatch===true: نُكمِل بـschools[] الطازجة المُتحقَّق منها فقط، صفر إضافة لـtrial.schoolId
  }

  const primarySchool = schools[0];
  const identity = await identityStore.createIdentityWithId(userId, { role: "director", schoolId: primarySchool.schoolId, stage: primarySchool.stage, displayName: "مدير" });

  const authorization: DirectorAuthorizationRecord = { userId, source: "signed_activation_v1", schools, authorizedAt: new Date().toISOString() };
  await identityStore.putDirectorAuthorization(authorization);
  await identityStore.markActivationConsumed(activationResult.payload.activationId);
  if (trial) await identityStore.deleteDirectorTrial(userId);

  const deviceId = getOrCreateDeviceId();
  runtimeAuthenticatedUserId = userId; // الجلسة تبقى بلا انقطاع — صفر إعادة PIN

  return { ok: true, session: buildActivatedSession(identity, deviceId, authorization) };
};

/**
 * المسار القديم legacy (مسار مدرسة واحدة مباشر، بلا تجربة وسيطة) — يبقى
 * بذاته بلا حذف، لكن الآن يُنشئ DirectorAuthorizationRecord أيضًا فور
 * النجاح (بدل الاعتماد فقط على الترحيل اللاحق)، ليتوافق فورًا مع النموذج
 * الجديد. صفر تغيير على شرط verifyDirectorActivation (scope مُطابَق) نفسه.
 */
export const setupDirector = async (input: { activationCredential: string; schoolId: string; stage: SchoolStage; displayName: string; pin: string; confirmPin: string }): Promise<DirectorSession> => {
  const activationResult = await verifyDirectorActivation(input.activationCredential, { schoolId: input.schoolId, stage: input.stage });
  if (!activationResult.ok) throw new Error(`بيانات اعتماد التفعيل غير صالحة: ${activationResult.error}`);
  if (!isValidPinFormat(input.pin)) throw new Error("صيغة PIN غير صالحة");
  if (input.pin !== input.confirmPin) throw new Error("PIN وتأكيده غير متطابقين");

  const identity = await identityStore.createIdentity({ role: "director", schoolId: input.schoolId, stage: input.stage, displayName: input.displayName });
  const credential = await derivePinCredential(input.pin);
  await identityStore.putDirectorCredential({ ...credential, userId: identity.userId, failedAttempts: 0, lockUntil: null, updatedAt: new Date().toISOString() });

  const authorization: DirectorAuthorizationRecord = { userId: identity.userId, source: "signed_activation_v1", schools: [{ schoolId: input.schoolId, stage: input.stage }], authorizedAt: new Date().toISOString() };
  await identityStore.putDirectorAuthorization(authorization);

  const deviceId = getOrCreateDeviceId();
  await identityStore.registerTrustedDevice(deviceId, identity.userId);
  await identityStore.markActivationConsumed(activationResult.payload.activationId);
  runtimeAuthenticatedUserId = identity.userId;

  return buildActivatedSession(identity, deviceId, authorization);
};

/**
 * تحقق PIN — يعمل لكل من DirectorTrial وDirectorAuthorization بلا تمييز
 * في آلية PIN نفسها (نفس DirectorCredentialRecord بمفتاح userId موحَّد).
 * الفارق الوحيد: بناء الجلسة الناتجة (activated أم trial) حسب أيّهما
 * موجود فعليًا لهذا userId.
 */
export const verifyDirectorPin = async (identityOrPseudo: UserIdentity, pin: string): Promise<VerifyPinResult> => {
  const userId = identityOrPseudo.userId;
  const credential = await identityStore.getDirectorCredential(userId);
  if (!credential) return { ok: false, reason: "invalid_pin" };

  if (credential.lockUntil && new Date(credential.lockUntil).getTime() > Date.now()) {
    return { ok: false, reason: "cooldown", cooldownUntil: credential.lockUntil };
  }

  const valid = await verifyPinCredential(pin, credential);
  if (!valid) {
    const failedAttempts = credential.failedAttempts + 1;
    const lockUntil = failedAttempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN ? new Date(Date.now() + COOLDOWN_MS).toISOString() : null;
    await identityStore.putDirectorCredential({ ...credential, failedAttempts, lockUntil, updatedAt: new Date().toISOString() });
    return lockUntil ? { ok: false, reason: "cooldown", cooldownUntil: lockUntil } : { ok: false, reason: "invalid_pin" };
  }

  await identityStore.putDirectorCredential({ ...credential, failedAttempts: 0, lockUntil: null, updatedAt: new Date().toISOString() });
  const deviceId = getOrCreateDeviceId();
  const existingDevice = await identityStore.getTrustedDevice(deviceId);
  if (!existingDevice) await identityStore.registerTrustedDevice(deviceId, userId);

  const identity = await identityStore.getIdentityById(userId);
  if (identity && identity.role === "director" && identity.status === "active") {
    const authorization = await migrateLegacyDirectorIfNeeded(identity);
    runtimeAuthenticatedUserId = userId;
    return { ok: true, session: buildActivatedSession(identity, deviceId, authorization) };
  }

  const trial = await identityStore.getDirectorTrial(userId);
  if (trial) {
    if (isDirectorTrialExpired(trial.startedAt)) {
      return { ok: false, reason: "trial_expired" };
    }
    runtimeAuthenticatedUserId = userId;
    return { ok: true, session: buildTrialSession(userId, trial.schoolId, deviceId) };
  }

  return { ok: false, reason: "invalid_pin" };
};

/**
 * قفل: يُصفِّر إثبات المصادقة في ذاكرة runtime الحالية فورًا وبصدق تام.
 */
export const lockDirectorSession = (userId: string): void => {
  if (runtimeAuthenticatedUserId === userId) {
    runtimeAuthenticatedUserId = null;
  }
};

/** مُحاكاة "إعادة تشغيل" لأغراض الاختبار فقط. */
export const __simulateNewRuntimeForTests = (): void => {
  runtimeAuthenticatedUserId = null;
};

/**
 * PHASE PILOT-50-F3.4 — حارس الكتابة الجديد، مستقل تمامًا عن
 * license/licenseGuard.ts (نظام ترخيص المعلم). يُستدعى من directorStore.ts
 * بدل assertWriteAllowed("director") القديمة. يعتمد على الحالة الفعلية
 * المُصادَق عليها في ذاكرة runtime (نفس مصدر الحقيقة المُستخدَم في
 * resolveDirectorAccess) — صفر اعتماد على أي trial/license خاص بالمعلم.
 */
export class DirectorWriteRestrictedError extends Error {
  constructor(message = "انتهت الفترة التجريبية. فعِّل خبير المدير للمتابعة في الكتابة.") {
    super(message);
    this.name = "DirectorWriteRestrictedError";
  }
}

export const assertDirectorWriteAllowed = async (): Promise<void> => {
  if (!runtimeAuthenticatedUserId) {
    throw new DirectorWriteRestrictedError("الرجاء تسجيل الدخول أولًا.");
  }

  const identity = await identityStore.getIdentityById(runtimeAuthenticatedUserId);
  if (identity && identity.role === "director" && identity.status === "active") {
    return; // activated — صفر قيد زمني
  }

  const trial = await identityStore.getDirectorTrial(runtimeAuthenticatedUserId);
  if (trial) {
    if (isDirectorTrialExpired(trial.startedAt)) {
      throw new DirectorWriteRestrictedError();
    }
    return; // trial نشطة — الكتابة المحلية مسموحة (تجربة منتج ذات معنى)
  }

  throw new DirectorWriteRestrictedError("الرجاء تسجيل الدخول أولًا.");
};

/**
 * PHASE PILOT-50-F3.4: أداة اختبار مُصدَّرة صراحة فقط — تُنشئ حالة "مدير
 * trial مُصادَق عليه" مباشرة عبر identityStore، **بلا** الاعتماد على
 * window.localStorage/getOrCreateDeviceId (يسمح باختبار directorStore في
 * بيئة Node البسيطة بلا jsdom). **ليست** جزءًا من أي مسار إنتاجي — تُستخدَم
 * فقط لإعداد سياق اختباري واقعي لاختبارات directorStore.ts القديمة.
 */
export const __setAuthenticatedDirectorTrialForTests = async (userId: string, schoolId: string): Promise<void> => {
  await identityStore.putDirectorTrial({ userId, schoolId, startedAt: new Date().toISOString() });
  runtimeAuthenticatedUserId = userId;
};
