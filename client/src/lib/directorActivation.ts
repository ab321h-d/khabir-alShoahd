/**
 * PHASE ID-2A.1: بيانات اعتماد تفعيل المدير — موقّعة رقميًا (ECDSA P-256)،
 * لا قائمة hashes ثابتة داخل الحزمة إطلاقًا (كانت DIRECTOR_ACTIVATION_
 * VERIFIER_HASHES من ID-2A، أُزيلت بالكامل، بلا fallback إليها). التطبيق
 * يحتوي المفتاح العام فقط (directorActivationConfig.ts)؛ المفتاح الخاص
 * يبقى خارج المستودع تمامًا، في أداة إصدار منفصلة (Phase مستقبلية).
 *
 * الاستهلاك أحادي المرة هنا محلي فقط لكل تثبيت (installation) — منع إعادة
 * استخدام نفس activationId على نفس الجهاز فقط. لا يمنع استخدامه على جهاز
 * مختلف تمامًا؛ هذا يتطلب خادمًا مركزيًا يتتبَّع الاستهلاك عالميًا.
 */

import type { SchoolStage } from "./identityStore";
import { identityStore } from "./identityStore";
import { verifyActivationSignature } from "./directorActivationCrypto";
import { DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK } from "./directorActivationConfig";

export type DirectorActivationPayload = {
  version: 1;
  activationId: string;
  schoolId: string;
  stage: SchoolStage;
  role: "director";
  issuedAt: string;
  expiresAt: string;
};

export type VerifyActivationResult =
  | { ok: true; payload: DirectorActivationPayload }
  | { ok: false; error: "no_public_key" | "malformed" | "invalid_signature" | "invalid_payload" | "unknown_version" | "wrong_role" | "scope_mismatch" | "expired" | "already_consumed" };

const validStages: readonly SchoolStage[] = ["elementary", "middle", "secondary"];

const isActivationPayloadShape = (value: unknown): value is DirectorActivationPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DirectorActivationPayload>;
  return candidate.version === 1
    && typeof candidate.activationId === "string" && candidate.activationId.length > 0
    && typeof candidate.schoolId === "string" && candidate.schoolId.trim().length > 0
    && typeof candidate.stage === "string" && validStages.includes(candidate.stage as SchoolStage)
    && candidate.role === "director"
    && typeof candidate.issuedAt === "string" && !Number.isNaN(new Date(candidate.issuedAt).getTime())
    && typeof candidate.expiresAt === "string" && !Number.isNaN(new Date(candidate.expiresAt).getTime());
};

/**
 * يتحقق من بيانات اعتماد تفعيل كاملة: التوقيع، شكل المحتوى، الإصدار، الدور،
 * تطابق المدرسة/المرحلة مع ما أُدخِل فعليًا، الانتهاء، وأخيرًا عدم استهلاكها
 * محليًا من قبل. لا يستهلك (consume) بنفسه — ذلك مسؤولية الاستدعاء الناجح
 * لـ setupDirector فقط، بعد نجاح كل الشروط الأخرى.
 */
export const verifyDirectorActivation = async (code: string, scope: { schoolId: string; stage: SchoolStage }): Promise<VerifyActivationResult> => {
  if (!DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK) return { ok: false, error: "no_public_key" };

  const signatureResult = await verifyActivationSignature(code, DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK);
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

  if (payload.role !== "director") return { ok: false, error: "wrong_role" };

  const normalizedSchoolId = scope.schoolId.trim();
  if (payload.schoolId !== normalizedSchoolId || payload.stage !== scope.stage) return { ok: false, error: "scope_mismatch" };

  if (new Date(payload.expiresAt).getTime() <= Date.now()) return { ok: false, error: "expired" };

  const consumed = await identityStore.isActivationConsumed(payload.activationId);
  if (consumed) return { ok: false, error: "already_consumed" };

  return { ok: true, payload };
};

/**
 * PHASE PILOT-50-F3.4 — للاستخدام في تدفق ترقية DirectorTrial فقط: تحقق
 * كامل **بلا** مطابقة scope مُسبَقة (صفر افتراض بأن trial.schoolId مصدر
 * ثقة — هو بيانات تجربة غير مُتحقَّق منها أصلًا). كل الفحوصات الأخرى
 * (توقيع/شكل/دور/انتهاء/استهلاك) مطابقة تمامًا لـverifyDirectorActivation
 * أعلاه — **صفر تعديل على تلك الدالة القديمة، صفر لمس لدلالات التحقق
 * التشفيري نفسها**. التطابق مع trial.schoolId (إن وُجد) يحدث لاحقًا، خارج
 * هذه الدالة، كقرار منفصل تمامًا (انظر §M في التدقيق — صفر إضافة صامتة).
 */
export const verifyDirectorActivationCredential = async (code: string): Promise<VerifyActivationResult> => {
  if (!DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK) return { ok: false, error: "no_public_key" };

  const signatureResult = await verifyActivationSignature(code, DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK);
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

  if (payload.role !== "director") return { ok: false, error: "wrong_role" };
  if (new Date(payload.expiresAt).getTime() <= Date.now()) return { ok: false, error: "expired" };

  const consumed = await identityStore.isActivationConsumed(payload.activationId);
  if (consumed) return { ok: false, error: "already_consumed" };

  return { ok: true, payload };
};

/**
 * PHASE PILOT-50-F3.4 — تطبيع post-verification بحت. يُستدعى **فقط بعد**
 * نجاح verifyDirectorActivationCredential أعلاه — صفر تعديل على البايتات
 * الموقَّعة أو منطق التحقق نفسه. v1 (schoolId+stage مفردان) → تمثيل داخلي
 * موحَّد schools[] (أساس v2 المستقبلية، بلا الحاجة لمفتاح توقيع جديد).
 */
export const normalizeActivationPayloadToSchools = (payload: DirectorActivationPayload): Array<{ schoolId: string; stage: SchoolStage }> => [
  { schoolId: payload.schoolId, stage: payload.stage },
];
