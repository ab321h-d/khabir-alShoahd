/**
 * PHASE ID-3A: بيانات اعتماد تفعيل المعلم — موقّعة رقميًا (ECDSA P-256)،
 * مستقلة تمامًا عن directorActivation.ts (صفر استيراد بينهما، مفتاح عام
 * منفصل). الاستهلاك أحادي المرة محلي فقط لكل تثبيت — يُعيد استخدام
 * identityStore.isActivationConsumed/markActivationConsumed العامتين (لا
 * ربط بدور في توقيعهما، آمن للمشاركة بين تفعيل المدير والمعلم دون تعارض
 * لأن activationId فريد عالميًا لكل بيانات اعتماد على حدة).
 */

import type { SchoolStage } from "./identityStore";
import { identityStore } from "./identityStore";
import { verifyActivationSignature } from "./teacherActivationCrypto";
import { TEACHER_ACTIVATION_PUBLIC_KEY_JWK } from "./teacherActivationConfig";

export type TeacherActivationPayload = {
  version: 1;
  activationId: string;
  schoolId: string;
  stage: SchoolStage;
  role: "teacher";
  issuedAt: string;
  expiresAt: string;
};

export type VerifyTeacherActivationResult =
  | { ok: true; payload: TeacherActivationPayload }
  | { ok: false; error: "no_public_key" | "malformed" | "invalid_signature" | "invalid_payload" | "unknown_version" | "wrong_role" | "scope_mismatch" | "expired" | "already_consumed" };

const validStages: readonly SchoolStage[] = ["elementary", "middle", "secondary"];

const isActivationPayloadShape = (value: unknown): value is TeacherActivationPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TeacherActivationPayload>;
  return candidate.version === 1
    && typeof candidate.activationId === "string" && candidate.activationId.length > 0
    && typeof candidate.schoolId === "string" && candidate.schoolId.trim().length > 0
    && typeof candidate.stage === "string" && validStages.includes(candidate.stage as SchoolStage)
    && candidate.role === "teacher"
    && typeof candidate.issuedAt === "string" && !Number.isNaN(new Date(candidate.issuedAt).getTime())
    && typeof candidate.expiresAt === "string" && !Number.isNaN(new Date(candidate.expiresAt).getTime());
};

/**
 * يتحقق من بيانات اعتماد تفعيل معلم كاملة: التوقيع، شكل المحتوى، الإصدار،
 * الدور، تطابق المدرسة/المرحلة، الانتهاء، وأخيرًا عدم استهلاكها محليًا من
 * قبل. لا يستهلك (consume) بنفسه — تلك مسؤولية setupTeacher الناجح فقط.
 */
export const verifyTeacherActivation = async (code: string, scope: { schoolId: string; stage: SchoolStage }): Promise<VerifyTeacherActivationResult> => {
  if (!TEACHER_ACTIVATION_PUBLIC_KEY_JWK) return { ok: false, error: "no_public_key" };

  const signatureResult = await verifyActivationSignature(code, TEACHER_ACTIVATION_PUBLIC_KEY_JWK);
  if (!signatureResult.ok) return { ok: false, error: signatureResult.error };

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(signatureResult.payloadText);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  if (typeof parsedPayload === "object" && parsedPayload !== null && "version" in parsedPayload && (parsedPayload as { version: unknown }).version !== 1) {
    return { ok: false, error: "unknown_version" };
  }
  if (!isActivationPayloadShape(parsedPayload)) return { ok: false, error: "invalid_payload" };
  const payload = parsedPayload;

  if (payload.role !== "teacher") return { ok: false, error: "wrong_role" };

  const normalizedSchoolId = scope.schoolId.trim();
  if (payload.schoolId !== normalizedSchoolId || payload.stage !== scope.stage) return { ok: false, error: "scope_mismatch" };

  if (new Date(payload.expiresAt).getTime() <= Date.now()) return { ok: false, error: "expired" };

  const consumed = await identityStore.isActivationConsumed(payload.activationId);
  if (consumed) return { ok: false, error: "already_consumed" };

  return { ok: true, payload };
};
