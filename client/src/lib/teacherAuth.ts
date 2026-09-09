/**
 * PHASE ID-3A: تنسيق حماية هوية المعلم — إعداد أول مرة (بعد تفعيل صالح)،
 * تحقق PIN، جهاز موثوق، جلسة، قفل. مستقل تمامًا عن directorAuth.ts (صفر
 * استيراد بينهما، معماريًا منفصل بالكامل حسب القرار المقفَل) — يُعيد
 * استخدام فقط الدوال العامة غير المرتبطة بدور من identityStore.ts
 * (createIdentity/getIdentityById/getTrustedDevice/registerTrustedDevice/
 * isActivationConsumed/markActivationConsumed)، ويحتفظ ببيانات اعتماد PIN
 * الخاصة بالمعلم في قاعدة IndexedDB منفصلة تمامًا هنا (لا تعديل على
 * identityStore.ts، الذي لا يوفر مخزن اعتماد عام — فقط مخزن خاص بالمدير).
 *
 * تنبيه تصميمي صريح: هذه حماية محلية للاستخدام المدرسي العادي، وليست إثبات
 * هوية رسميًا — لا ضمان تشفيري بلا خادم بأن صاحب الجهاز هو المعلم الحقيقي.
 */

import { identityStore, type SchoolStage, type UserIdentity } from "./identityStore";
import { derivePinCredential, isValidPinFormat, verifyPinCredential } from "./pinCrypto";
import { verifyTeacherActivation } from "./teacherActivation";

export type TeacherSession = {
  userId: string;
  role: "teacher";
  schoolId: string;
  stage: SchoolStage;
  deviceId: string;
  authenticatedAt: string;
};

export type TeacherAccessState =
  | { status: "loading" }
  | { status: "activation-required" }
  | { status: "locked"; identity: UserIdentity; cooldownUntil: string | null }
  | { status: "authenticated"; session: TeacherSession };

export type VerifyTeacherPinResult =
  | { ok: true; session: TeacherSession }
  | { ok: false; reason: "invalid_pin" | "cooldown" | "disabled"; cooldownUntil?: string };

// ===== مخزن بيانات اعتماد PIN للمعلم — مستقل تمامًا عن مخزن المدير =====

type TeacherCredentialRecord = Awaited<ReturnType<typeof derivePinCredential>> & {
  userId: string;
  failedAttempts: number;
  lockUntil: string | null;
  updatedAt: string;
};

const credentialsDatabaseName = "khabir-teacher-credentials-local";
const credentialsStoreName = "credentials";
const credentialsDatabaseVersion = 1;

const openCredentialsDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(credentialsDatabaseName, credentialsDatabaseVersion);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(credentialsStoreName)) database.createObjectStore(credentialsStoreName, { keyPath: "userId" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const closeWhenDone = <T,>(database: IDBDatabase, value: Promise<T>) => value.finally(() => database.close());
const requestValue = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const getTeacherCredential = async (userId: string): Promise<TeacherCredentialRecord | null> => {
  const database = await openCredentialsDatabase();
  const result = await closeWhenDone(database, requestValue(database.transaction(credentialsStoreName, "readonly").objectStore(credentialsStoreName).get(userId)));
  return (result as TeacherCredentialRecord | undefined) || null;
};

const putTeacherCredential = async (record: TeacherCredentialRecord): Promise<void> => {
  const database = await openCredentialsDatabase();
  await closeWhenDone(database, requestValue(database.transaction(credentialsStoreName, "readwrite").objectStore(credentialsStoreName).put(record)));
};

// ===== جهاز موثوق محلي + علامة جلسة =====

const DEVICE_ID_STORAGE_KEY = "khabir-teacher-device-id";
const SESSION_ACTIVE_STORAGE_KEY = "khabir-teacher-session-active";

const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

/** deviceId عشوائي دائم لهذا المتصفح/التثبيت — منفصل تمامًا عن deviceId الخاص بالمدير. */
export const getOrCreateTeacherDeviceId = (): string => {
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
};

const buildSession = (identity: UserIdentity, deviceId: string): TeacherSession => ({
  userId: identity.userId,
  role: "teacher",
  schoolId: identity.schoolId,
  stage: identity.stage,
  deviceId,
  authenticatedAt: new Date().toISOString(),
});

const markSessionActive = () => window.localStorage.setItem(SESSION_ACTIVE_STORAGE_KEY, "1");
const isSessionMarkedActive = () => window.localStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) === "1";

/**
 * يحسم حالة الوصول الحالية دون طلب أي تفاعل من المستخدم — نفس منطق
 * resolveDirectorAccess تمامًا (النمط الأمني المُثبَت)، مطبَّق هنا بشكل
 * مستقل بالكامل لهوية المعلم.
 */
export const resolveTeacherAccess = async (): Promise<TeacherAccessState> => {
  const deviceId = getOrCreateTeacherDeviceId();
  const device = await identityStore.getTrustedDevice(deviceId);
  if (!device) return { status: "activation-required" };

  const identity = await identityStore.getIdentityById(device.userId);
  if (!identity || identity.role !== "teacher" || identity.status !== "active") {
    return { status: "activation-required" };
  }

  if (isSessionMarkedActive()) {
    return { status: "authenticated", session: buildSession(identity, deviceId) };
  }

  const credential = await getTeacherCredential(identity.userId);
  const cooldownUntil = credential?.lockUntil && new Date(credential.lockUntil).getTime() > Date.now() ? credential.lockUntil : null;
  return { status: "locked", identity, cooldownUntil };
};

/**
 * إنشاء هوية معلم لأول مرة على هذا التثبيت — تتطلب صراحة activationCredential
 * صالحًا (يُتحقَّق منه أولًا، قبل أي كتابة). teacherId = UserIdentity.userId
 * الناتج، وليس activationId (معرّف الدعوة نفسها، يُستهلَك مرة واحدة فقط ولا
 * يُستخدَم كهوية دائمة).
 */
export const setupTeacher = async (input: { activationCredential: string; schoolId: string; stage: SchoolStage; displayName: string; pin: string; confirmPin: string }): Promise<TeacherSession> => {
  const activationResult = await verifyTeacherActivation(input.activationCredential, { schoolId: input.schoolId, stage: input.stage });
  if (!activationResult.ok) throw new Error(`بيانات اعتماد التفعيل غير صالحة: ${activationResult.error}`);
  if (!isValidPinFormat(input.pin)) throw new Error("صيغة PIN غير صالحة");
  if (input.pin !== input.confirmPin) throw new Error("PIN وتأكيده غير متطابقين");

  const identity = await identityStore.createIdentity({ role: "teacher", schoolId: input.schoolId, stage: input.stage, displayName: input.displayName });
  const credential = await derivePinCredential(input.pin);
  await putTeacherCredential({ ...credential, userId: identity.userId, failedAttempts: 0, lockUntil: null, updatedAt: new Date().toISOString() });

  const deviceId = getOrCreateTeacherDeviceId();
  await identityStore.registerTrustedDevice(deviceId, identity.userId);
  await identityStore.markActivationConsumed(activationResult.payload.activationId);
  markSessionActive();

  return buildSession(identity, deviceId);
};

/** تحقق PIN لهوية معلم معروفة مسبقًا — نفس منطق verifyDirectorPin تمامًا. */
export const verifyTeacherPin = async (identity: UserIdentity, pin: string): Promise<VerifyTeacherPinResult> => {
  if (identity.status !== "active") return { ok: false, reason: "disabled" };

  const credential = await getTeacherCredential(identity.userId);
  if (!credential) return { ok: false, reason: "invalid_pin" };

  if (credential.lockUntil && new Date(credential.lockUntil).getTime() > Date.now()) {
    return { ok: false, reason: "cooldown", cooldownUntil: credential.lockUntil };
  }

  const valid = await verifyPinCredential(pin, credential);
  if (!valid) {
    const failedAttempts = credential.failedAttempts + 1;
    const lockUntil = failedAttempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN ? new Date(Date.now() + COOLDOWN_MS).toISOString() : null;
    await putTeacherCredential({ ...credential, failedAttempts, lockUntil, updatedAt: new Date().toISOString() });
    return lockUntil ? { ok: false, reason: "cooldown", cooldownUntil: lockUntil } : { ok: false, reason: "invalid_pin" };
  }

  await putTeacherCredential({ ...credential, failedAttempts: 0, lockUntil: null, updatedAt: new Date().toISOString() });
  const deviceId = getOrCreateTeacherDeviceId();
  const existingDevice = await identityStore.getTrustedDevice(deviceId);
  if (!existingDevice) await identityStore.registerTrustedDevice(deviceId, identity.userId);
  markSessionActive();

  return { ok: true, session: buildSession(identity, deviceId) };
};

/**
 * قفل: ينهي الجلسة المحلية النشطة فقط. لا يحذف الهوية، لا بيانات اعتماد
 * PIN، لا الجهاز الموثوق نفسه.
 */
export const lockTeacherSession = (): void => {
  window.localStorage.removeItem(SESSION_ACTIVE_STORAGE_KEY);
};
