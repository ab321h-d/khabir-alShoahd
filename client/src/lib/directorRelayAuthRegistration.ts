/**
 * PHASE NEXT-2E-B1B + BLOCKER-REVIEW — تسجيل مفتاح relay-auth العام لدى
 * الخادم (POST /relay-auth/register). يستخدم نفس اصطلاح
 * VITE_LICENSE_BACKEND_URL الموجود بالفعل في teacherTrialApi.ts
 * (مُتحقَّق منه مباشرة قبل إعادة الاستخدام: fail-closed لو غائبة، إزالة
 * "/" زائدة من النهاية).
 *
 * **تصحيح بروتوكول مُثبَت بأدلة مباشرة من كود الخادم الفعلي
 * (backend commit 1587d52، functions/relayAuthRegistrationHttp.mjs)**:
 * POST /relay-auth/register هي bootstrap first-binding endpoint **غير
 * موقَّعة** — الخادم يتحقق فقط من method/Content-Type/حجم/schema JSON
 * (recipientId + relayAuthPublicKeyJwk)، **صفر فحص لأي X-Relay-* header
 * إطلاقًا**، صفر استدعاء لـrelaySignedRequestVerifier في هذا المسار —
 * مؤكَّد بحثًا مباشرًا، لا استنتاجًا. هذا منطقي: recipientId لا يملك
 * ربطًا بعد وقت التسجيل الأول، فلا يوجد مفتاح عام مُسجَّل مسبقًا
 * للتحقق ضده. **لذلك هذا الملف لا يستدعي buildSignedRelayRequest ولا
 * يُرسِل أي header توقيع** — directorRelaySignedRequest.ts تبقى في
 * B1B كأساس لنقاط نهاية relay محمية *مستقبلية* بعد وجود الربط، لا
 * لهذا المسار.
 *
 * **دلالة أمنية مُقفَلة**: التسجيل يعني فقط "الخادم ربط recipientId هذا
 * بشكل غير قابل للتغيير بمفتاح relay-auth العام هذا وفق نموذج bootstrap
 * binding الأول من B1A" — صفر إثبات هوية مدير/مدرسة/عضوية/دور/ثقة.
 *
 * **صفر تخزين محلي لعلامة "registered=true"** — الربط لدى الخادم هو
 * مصدر الحقيقة الوحيد؛ التسجيل idempotent ويمكن إعادة محاولته بأمان
 * عند الحاجة (200 unchanged عادي، لا خطأ).
 */
import { getOrCreateDirectorRecipientProfile } from "./directorRecipientProfile";
import { getOrCreateDirectorRelayAuthPublicKey } from "./directorRelayAuthIdentity";

export type RegistrationOutcome =
  | { status: "created" }
  | { status: "unchanged" }
  | { status: "conflict" }
  | { status: "network_error" }
  | { status: "config_error" }
  | { status: "malformed_response" };

const getLicenseBackendUrl = (): string => {
  const value = import.meta.env.VITE_LICENSE_BACKEND_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("license_backend_url_required");
  }
  return value.replace(/\/+$/, "");
};

/**
 * يتحقق من عقد الاستجابة الفعلي الكامل — الخادم يُعيد بنية JSON محدَّدة
 * صراحة لكلا 201 و200: {ok:true, data:{status:"created"|"unchanged"}}
 * (مؤكَّد من functions/httpFoundation.mjs's ok() ومن الاستدعاء المباشر في
 * relayAuthRegistrationHttp.mjs) — status code HTTP وحده غير كافٍ
 * لإثبات مطابقة العقد الكامل، فك تشفير body وتحقق data.status مطلوبان.
 */
const parseSuccessBody = async (response: Response, expectedStatus: "created" | "unchanged"): Promise<boolean> => {
  try {
    const parsed = await response.json();
    return parsed?.ok === true && parsed?.data?.status === expectedStatus;
  } catch {
    return false;
  }
};

/**
 * §5 — نتائج صارمة، fail-closed كامل. 409 (binding_conflict): **صفر
 * دوران مفتاح، صفر مفتاح بديل، صفر استبدال recipientId، صفر إعادة
 * محاولة صامتة بهوية مختلفة** — تُعاد "conflict" فقط، القرار اللاحق
 * (إن وُجد) يبقى خارج نطاق B1B تمامًا.
 */
export const registerDirectorRelayAuthKey = async (): Promise<RegistrationOutcome> => {
  let backendUrl: string;
  try {
    backendUrl = getLicenseBackendUrl();
  } catch {
    return { status: "config_error" };
  }

  const recipientProfile = await getOrCreateDirectorRecipientProfile();
  const publicKeyJwk = await getOrCreateDirectorRelayAuthPublicKey();

  const bodyText = JSON.stringify({ recipientId: recipientProfile.recipientId, relayAuthPublicKeyJwk: publicKeyJwk });
  const path = "/relay-auth/register";

  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // صفر header توقيع — endpoint غير موقَّعة (مؤكَّد من الخادم)
      body: bodyText,
    });
  } catch {
    return { status: "network_error" };
  }

  if (response.status === 201) {
    return (await parseSuccessBody(response, "created")) ? { status: "created" } : { status: "malformed_response" };
  }
  if (response.status === 200) {
    return (await parseSuccessBody(response, "unchanged")) ? { status: "unchanged" } : { status: "malformed_response" };
  }
  if (response.status === 409) return { status: "conflict" };

  return { status: "malformed_response" };
};
