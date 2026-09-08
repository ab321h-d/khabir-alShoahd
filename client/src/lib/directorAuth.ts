/**
 * PHASE ID-2: تنسيق حماية حساب المدير — إعداد أول مرة، تحقق PIN، جهاز موثوق،
 * جلسة، قفل. طبقة منطق فوق identityStore.ts + pinCrypto.ts. لا علاقة لها
 * بنظام الترخيص إطلاقًا (لا استيراد من license/*).
 *
 * تنبيه تصميمي صريح: هذه حماية محلية للاستخدام المدرسي العادي، وليست إثبات
 * هوية رسميًا — لا ضمان تشفيري بلا خادم بأن صاحب الجهاز هو المدير الحقيقي.
 */

import { identityStore, type SchoolStage, type UserIdentity } from "./identityStore";
import { derivePinCredential, isValidPinFormat, verifyPinCredential } from "./pinCrypto";
import { verifyDirectorActivation } from "./directorActivation";

export type DirectorSession = {
  userId: string;
  role: "director";
  schoolId: string;
  stage: SchoolStage;
  deviceId: string;
  authenticatedAt: string;
};

export type DirectorAccessState =
  | { status: "loading" }
  | { status: "activation-required" }
  | { status: "locked"; identity: UserIdentity; cooldownUntil: string | null }
  | { status: "authenticated"; session: DirectorSession };

export type VerifyPinResult =
  | { ok: true; session: DirectorSession }
  | { ok: false; reason: "invalid_pin" | "cooldown" | "disabled"; cooldownUntil?: string };

const DEVICE_ID_STORAGE_KEY = "khabir-director-device-id";
const SESSION_ACTIVE_STORAGE_KEY = "khabir-director-session-active";

const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

/** deviceId عشوائي دائم لهذا المتصفح/التثبيت — لا fingerprinting، لا ربط بعتاد الجهاز. */
export const getOrCreateDeviceId = (): string => {
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
};

const buildSession = (identity: UserIdentity, deviceId: string): DirectorSession => ({
  userId: identity.userId,
  role: "director",
  schoolId: identity.schoolId,
  stage: identity.stage,
  deviceId,
  authenticatedAt: new Date().toISOString(),
});

const markSessionActive = () => window.localStorage.setItem(SESSION_ACTIVE_STORAGE_KEY, "1");
const isSessionMarkedActive = () => window.localStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === "1";

/**
 * يحسم حالة الوصول الحالية دون طلب أي تفاعل من المستخدم: يقرأ deviceId
 * المحلي، يبحث عن جهاز موثوق مطابق، يتحقق من الهوية المرتبطة به (نشطة
 * ودورها مدير)، ثم يعتمد على علامة الجلسة المحلية لتحديد authenticated
 * مقابل locked. جهاز بلا أي جهاز موثوق مطابق = activation-required دائمًا
 * (لا setup-required — إنشاء مدير جديد يتطلب بيانات اعتماد تفعيل صالحة،
 * لا مجرد "عدم وجود هوية محلية").
 */
export const resolveDirectorAccess = async (): Promise<DirectorAccessState> => {
  const deviceId = getOrCreateDeviceId();
  const device = await identityStore.getTrustedDevice(deviceId);
  if (!device) return { status: "activation-required" };

  const identity = await identityStore.getIdentityById(device.userId);
  if (!identity || identity.role !== "director" || identity.status !== "active") {
    return { status: "activation-required" };
  }

  if (isSessionMarkedActive()) {
    return { status: "authenticated", session: buildSession(identity, deviceId) };
  }

  const credential = await identityStore.getDirectorCredential(identity.userId);
  const cooldownUntil = credential?.lockUntil && new Date(credential.lockUntil).getTime() > Date.now() ? credential.lockUntil : null;
  return { status: "locked", identity, cooldownUntil };
};

/**
 * إنشاء هوية مدير لأول مرة على هذا التثبيت (installation) — الدالة العامة
 * الوحيدة القادرة على إنشاء هوية مدير + بيانات اعتماد PIN + جهاز موثوق معًا.
 * تتطلب صراحة activationCredential صالحًا (يُتحقَّق منه أولًا، قبل أي كتابة).
 * PIN هنا مسؤول فقط عن التفعيل اللاحق (Authentication)، لا عن التفويض
 * بالإنشاء نفسه (Activation) — الفصل بينهما مقصود ومقفَل معماريًا.
 *
 * الاستهلاك أحادي المرة هنا محلي فقط (per-installation)، لا عالمي عبر
 * أجهزة متعددة: بمجرد نجاح هذا الاستدعاء، يُسجَّل هذا الجهاز موثوقًا
 * ومرتبطًا بهوية مدير — resolveDirectorAccess لن يُعيد activation-required
 * لهذا الجهاز بعد الآن (الحالة تصبح locked/authenticated). لا ضمان أن نفس
 * كود التفعيل غير قابل لإعادة الاستخدام على جهاز آخر مختلف بلا خادم مركزي
 * يتتبّع الاستهلاك عالميًا.
 */
export const setupDirector = async (input: { activationCredential: string; schoolId: string; stage: SchoolStage; displayName: string; pin: string; confirmPin: string }): Promise<DirectorSession> => {
  const activationResult = await verifyDirectorActivation(input.activationCredential, { schoolId: input.schoolId, stage: input.stage });
  if (!activationResult.ok) throw new Error(`بيانات اعتماد التفعيل غير صالحة: ${activationResult.error}`);
  if (!isValidPinFormat(input.pin)) throw new Error("صيغة PIN غير صالحة");
  if (input.pin !== input.confirmPin) throw new Error("PIN وتأكيده غير متطابقين");

  const identity = await identityStore.createIdentity({ role: "director", schoolId: input.schoolId, stage: input.stage, displayName: input.displayName });
  const credential = await derivePinCredential(input.pin);
  await identityStore.putDirectorCredential({ ...credential, userId: identity.userId, failedAttempts: 0, lockUntil: null, updatedAt: new Date().toISOString() });

  const deviceId = getOrCreateDeviceId();
  await identityStore.registerTrustedDevice(deviceId, identity.userId);
  await identityStore.markActivationConsumed(activationResult.payload.activationId);
  markSessionActive();

  return buildSession(identity, deviceId);
};

/**
 * تحقق PIN لهوية معروفة مسبقًا (سواء من نفس الجهاز الموثوق بعد قفل، أو —
 * ضمن حدود هذه المرحلة — أي هوية أُحضِرت للتحقق). عند النجاح: يُسجَّل
 * الجهاز الحالي موثوقًا (إن لم يكن أصلًا) وتُنشأ جلسة. عند الفشل: عدّاد
 * محاولات محلي بسيط + تهدئة (cooldown) — حماية ضد التخمين العرضي فقط، لا
 * ضد مهاجم متقدم، ولا تؤدي أبدًا لفقد دائم للبيانات.
 */
export const verifyDirectorPin = async (identity: UserIdentity, pin: string): Promise<VerifyPinResult> => {
  if (identity.status !== "active") return { ok: false, reason: "disabled" };

  const credential = await identityStore.getDirectorCredential(identity.userId);
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
  if (!existingDevice) await identityStore.registerTrustedDevice(deviceId, identity.userId);
  markSessionActive();

  return { ok: true, session: buildSession(identity, deviceId) };
};

/**
 * قفل: ينهي الجلسة المحلية النشطة فقط. لا يحذف الهوية، لا بيانات اعتماد
 * PIN، لا الجهاز الموثوق نفسه — الجهاز يبقى معروفًا، فقط يُطلَب PIN مجددًا.
 */
export const lockDirectorSession = (): void => {
  window.localStorage.removeItem(SESSION_ACTIVE_STORAGE_KEY);
};
