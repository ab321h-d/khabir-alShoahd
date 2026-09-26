/**
 * PHASE NEXT-2E-B2-A2-B + FRONTEND-REDEMPTION-RECOVERY — POST
 * /relay-delivery-sessions/{sessionId}/redeem (بلا مصادقة relay-auth).
 * **صفر capabilitySecret في الطلب**. عقد backend 0029 إلزامي — صفر
 * fallback للبروتوكول القديم {deliveryProof} فقط.
 *
 * redemptionAttemptId **لا يُنشَأ هنا إطلاقًا** — يجب أن يكون موجودًا
 * ومُثبَّتًا دائمًا في sessionStorage (عبر ensurePendingDeliveryAttemptId
 * في directorDeliverySessionUrl.ts) **قبل** استدعاء هذه الدالة. فور
 * نجاح HTTP، recipientId/capabilityId يُثبَّتان دائمًا (recordResolvedDeliveryIdentity)
 * **قبل** أي محاولة IndexedDB محلية قد تفشل — صفر اعتماد على React
 * useState وحدها لهذه الحقيقة الحرجة.
 */
import { getStoredUploadCapability, saveUploadCapability, type StoredUploadCapability } from "./relayUploadCapabilityStore";
import { isValidCanonical16ByteToken, isValidCanonical32ByteToken } from "./relayUploadCapabilityCrypto";
import { recordResolvedDeliveryIdentity } from "./directorDeliverySessionUrl";

const getLicenseBackendUrl = (): string => {
  const value = import.meta.env.VITE_LICENSE_BACKEND_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("license_backend_url_required");
  }
  return value.replace(/\/+$/, "");
};

export type RedeemOutcome =
  | { status: "redeemed"; recipientId: string; capabilityId: string }
  | { status: "existing_capability_conflict"; recipientId: string; capabilityId: string; existing: StoredUploadCapability }
  /**
   * الجلسة استُهلِكت بنجاح فعليًا على الخادم (HTTP نجح) وresolvedIdentity
   * أصبحت مُثبَّتة دائمًا في sessionStorage، لكن فحص القدرة المحلية
   * الموجودة فشل (خطأ IndexedDB أو غيره). إعادة استدعاء redeem ممنوعة
   * تمامًا الآن (single-use) — الاستئناف يكون محليًا فقط عبر
   * retryLocalCapabilityResolution، حتى بعد refresh.
   */
  | { status: "local_lookup_failed"; recipientId: string; capabilityId: string }
  /**
   * نجح HTTP فعليًا، لكن **تثبيت** resolvedIdentity في sessionStorage
   * نفسه فشل (لا القراءة المحلية اللاحقة). §4/§7: صفر ادّعاء نجاح،
   * النية المعلَّقة (وredemptionAttemptId الثابت) تبقى كما هي — retry
   * عبر HTTP بنفس attemptId آمن تمامًا (backend 0029 idempotent).
   */
  | { status: "identity_persistence_failed" }
  | { status: "session_unavailable" }
  | { status: "network_error" }
  | { status: "config_error" }
  | { status: "malformed_response" };

const parseRedeemSuccessBody = async (response: Response): Promise<{ recipientId: string; capabilityId: string } | null> => {
  try {
    const parsed = await response.json();
    if (parsed?.ok !== true) return null;
    const { status, recipientId, capabilityId } = parsed.data ?? {};
    if (status !== "redeemed") return null;
    if (typeof recipientId !== "string" || typeof capabilityId !== "string") return null;
    return { recipientId, capabilityId };
  } catch {
    return null;
  }
};

/** فحص التعارض المحلي — معزول ليُستدعى مجددًا بأمان (بلا شبكة) عبر retryLocalCapabilityResolution. */
const resolveLocalConflict = async (recipientId: string, capabilityId: string): Promise<RedeemOutcome> => {
  const existing = await getStoredUploadCapability(recipientId); // قد ترمي — تُلتقَط من طرف المستدعي دائمًا
  if (existing && existing.capabilityId !== capabilityId) {
    return { status: "existing_capability_conflict", recipientId, capabilityId, existing };
  }
  return { status: "redeemed", recipientId, capabilityId };
};

/**
 * الخطوة 1 — استدعاء الشبكة (مرة واحدة فقط لكل استدعاء، لكن آمن
 * للإعادة بنفس redemptionAttemptId بفضل idempotency الخادم) + تثبيت
 * الهوية دائمًا + فحص محلي. **صفر حفظ IndexedDB هنا**.
 *
 * redemptionAttemptId إلزامي — يُتحقَّق شكليًا محليًا **قبل** أي fetch
 * (نفس قيد الخادم: 16 بايت canonical دقيق، مُثبَت عبر round-trip).
 */
export const redeemDeliverySession = async (params: { sessionId: string; deliveryProof: string; redemptionAttemptId: string }): Promise<RedeemOutcome> => {
  if (!isValidCanonical32ByteToken(params.deliveryProof) || !isValidCanonical16ByteToken(params.redemptionAttemptId)) {
    return { status: "malformed_response" }; // خطأ برمجي محلي — صفر إرسال لقيمة غير قانونية أصلًا
  }

  let backendUrl: string;
  try {
    backendUrl = getLicenseBackendUrl();
  } catch {
    return { status: "config_error" };
  }

  const bodyText = JSON.stringify({ deliveryProof: params.deliveryProof, redemptionAttemptId: params.redemptionAttemptId });
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/relay-delivery-sessions/${params.sessionId}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
    });
  } catch {
    return { status: "network_error" };
  }

  if (response.status === 410) return { status: "session_unavailable" };
  if (response.status !== 200) return { status: "malformed_response" };

  const success = await parseRedeemSuccessBody(response);
  if (!success) return { status: "malformed_response" };

  // §4: تثبيت الهوية دائمًا **قبل** أي محاولة IndexedDB — نقطة الفصل الحاسمة
  try {
    recordResolvedDeliveryIdentity(params.sessionId, params.redemptionAttemptId, success);
  } catch {
    return { status: "identity_persistence_failed" }; // retry HTTP بنفس attemptId آمن — لا ادّعاء نجاح
  }

  try {
    return await resolveLocalConflict(success.recipientId, success.capabilityId);
  } catch {
    return { status: "local_lookup_failed", recipientId: success.recipientId, capabilityId: success.capabilityId };
  }
};

/**
 * PHASE FIX — إعادة محاولة الفحص/القرار المحلي **بلا أي طلب شبكة** —
 * آمنة تمامًا للاستدعاء المتكرر (بما في ذلك بعد refresh)، لأن الجلسة
 * على الخادم استُهلِكت بالفعل وresolvedIdentity مُثبَّتة محليًا بالفعل.
 */
export const retryLocalCapabilityResolution = async (params: { recipientId: string; capabilityId: string }): Promise<RedeemOutcome> => {
  try {
    return await resolveLocalConflict(params.recipientId, params.capabilityId);
  } catch {
    return { status: "local_lookup_failed", recipientId: params.recipientId, capabilityId: params.capabilityId };
  }
};

/** يُستدعى فقط بعد نتيجة "redeemed" مؤكَّدة — الحفظ المحلي الفعلي. قد ترمي؛ المستدعي (المكوّن) يلتقطها صراحة. */
export const confirmSaveRedeemedCapability = async (params: { recipientId: string; capabilityId: string; capabilitySecret: string }) =>
  saveUploadCapability(params);
