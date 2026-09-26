/**
 * PHASE NEXT-2E-B2-A2-B + FRONTEND-REDEMPTION-RECOVERY — نقل رابط/hash
 * جلسة تسليم القدرة + حالة استرداد دائمة عبر refresh/network retry.
 * **مستقل تمامًا** عن directorPairingUrl.ts — مفتاح hash مختلف
 * (`deliver` لا `pair-director`)، مفتاح sessionStorage مختلف تمامًا.
 *
 * الحمولة الأصلية (sessionId/deliveryProof/capabilitySecret) تُنقَل
 * حصرًا عبر URL hash — لا يصل الخادم في أي طلب HTTP navigation عادي.
 * shape: #deliver=<sessionId>.<deliveryProof>.<capabilitySecret>
 *
 * **إضافة جديدة**: الحالة المحفوظة في sessionStorage تحمل أيضًا
 * redemptionAttemptId (يُنشَأ مرة واحدة فقط قبل أول POST /redeem،
 * يبقى ثابتًا عبر refresh/network retry — عقد backend 0029 idempotent
 * يتطلب هذا الثبات) وresolvedIdentity (recipientId/capabilityId من
 * الخادم بعد نجاح HTTP، محفوظة **قبل** أي محاولة IndexedDB محلية قد
 * تفشل — صفر اعتماد على React useState وحدها لهذه الحقيقة الحرجة).
 */
import { decodeCanonicalBase64UrlExactLength, generateCanonical16ByteToken, isValidCanonical16ByteToken } from "./relayUploadCapabilityCrypto";

const HASH_KEY = "deliver";
const PENDING_STORAGE_KEY = "khabir-pending-relay-delivery"; // مفتاح مستقل تمامًا عن khabir-pending-director-pairing

export interface DeliverySessionIntent {
  sessionId: string;
  deliveryProof: string;
  capabilitySecret: string;
}

export interface ResolvedDeliveryIdentity {
  recipientId: string;
  capabilityId: string;
}

export type DeliveryHashParseResult =
  | { kind: "none" }
  | { kind: "intent"; intent: DeliverySessionIntent; redemptionAttemptId: string | null; resolvedIdentity: ResolvedDeliveryIdentity | null }
  | { kind: "malformed" };

const buildTeacherRootUrl = (): URL => {
  const url = new URL(window.location.href);
  url.pathname = import.meta.env.BASE_URL;
  url.search = "";
  url.hash = "";
  return url;
};

export const buildDeliverySessionUrl = (sessionId: string, deliveryProof: string, capabilitySecret: string): string => {
  const url = buildTeacherRootUrl();
  url.hash = `${HASH_KEY}=${sessionId}.${deliveryProof}.${capabilitySecret}`;
  return url.toString();
};

/**
 * يميِّز none/intent/malformed بدقة — hash موجود لكن بمكوِّن ناقص/زائد/
 * طول خاطئ/ترميز غير canonical لأي مقطع من الثلاثة => malformed صراحة.
 * القراءة المباشرة من hash **دائمًا** تُعيد redemptionAttemptId/
 * resolvedIdentity كـnull — هذان يُضافان فقط لاحقًا عبر sessionStorage.
 */
export const parseDeliveryHashFromLocation = (): DeliveryHashParseResult => {
  const rawHash = window.location.hash.replace(/^#/, "");
  if (!rawHash.startsWith(`${HASH_KEY}=`)) return { kind: "none" };

  const rawValue = rawHash.slice(`${HASH_KEY}=`.length);
  if (rawValue.length === 0) return { kind: "malformed" };

  const parts = rawValue.split(".");
  if (parts.length !== 3) return { kind: "malformed" };

  const [sessionId, deliveryProof, capabilitySecret] = parts;
  if (!decodeCanonicalBase64UrlExactLength(sessionId, 16)) return { kind: "malformed" };
  if (!decodeCanonicalBase64UrlExactLength(deliveryProof, 32)) return { kind: "malformed" };
  if (!decodeCanonicalBase64UrlExactLength(capabilitySecret, 32)) return { kind: "malformed" };

  return { kind: "intent", intent: { sessionId, deliveryProof, capabilitySecret }, redemptionAttemptId: null, resolvedIdentity: null };
};

export const clearDeliveryHashFromLocation = (): void => {
  const parsed = parseDeliveryHashFromLocation();
  if (parsed.kind === "none") return; // hash غير ذي صلة (مثل pair-director) يبقى بلا لمس
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
};

/**
 * نفس مبدأ capturePendingPairingIntent (FIX2) — يُستدعى مرة واحدة عند
 * أعلى نقطة تحميل ممكنة (App.tsx)، **قبل** أي بوابة مصادقة. لو نية
 * معلَّقة **موجودة بالفعل** في sessionStorage (مثلًا مع attemptId/
 * resolvedIdentity مُثبَّتَين من محاولة سابقة)، **لا تُستبدَل صامتًا**
 * بنسخة جديدة فارغة من hash — يُحافَظ على الحالة الغنية القائمة إلا لو
 * كانت لجلسة مختلفة فعليًا (sessionId مختلف) أو hash يحمل نية جديدة.
 */
export const capturePendingDeliveryIntent = (): void => {
  const parsedFromHash = parseDeliveryHashFromLocation();
  if (parsedFromHash.kind === "none") return;

  try {
    const stored = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (stored) {
      const existing = parseStoredPendingIntent(stored);
      if (existing && existing.kind === "intent" && parsedFromHash.kind === "intent" && existing.intent.sessionId === parsedFromHash.intent.sessionId) {
        return; // نفس الجلسة بالضبط — الحالة الغنية الموجودة (attemptId/resolvedIdentity) تبقى بلا استبدال
      }
    }
    window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(parsedFromHash));
  } catch { /* sessionStorage غير متاح — السقوط الاحتياطي لقراءة hash المباشرة يبقى يعمل */ }
};

/** مُدقِّق runtime صريح لكل حقل — سجل مُشوَّه fail-closed لكل حقل على حدة (M: رفض آمن بلا تدمير النية الأساسية الصالحة). */
const parseStoredPendingIntent = (raw: string): DeliveryHashParseResult | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;

  if (candidate.kind === "malformed") return { kind: "malformed" };
  if (candidate.kind !== "intent") return null;

  const intent = candidate.intent as Record<string, unknown> | undefined;
  if (typeof intent !== "object" || intent === null) return null;
  const { sessionId, deliveryProof, capabilitySecret } = intent;
  if (typeof sessionId !== "string" || !decodeCanonicalBase64UrlExactLength(sessionId, 16)) return null;
  if (typeof deliveryProof !== "string" || !decodeCanonicalBase64UrlExactLength(deliveryProof, 32)) return null;
  if (typeof capabilitySecret !== "string" || !decodeCanonicalBase64UrlExactLength(capabilitySecret, 32)) return null;

  // redemptionAttemptId: null صالح دائمًا؛ قيمة مُشوَّهة => تُعامَل كـnull (لا تُفسِد النية الأساسية الصالحة)
  const rawAttemptId = candidate.redemptionAttemptId;
  const redemptionAttemptId = typeof rawAttemptId === "string" && isValidCanonical16ByteToken(rawAttemptId) ? rawAttemptId : null;

  // resolvedIdentity: null صالح دائمًا؛ شكل مُشوَّه/حقول غير صالحة => تُعامَل كـnull
  const rawIdentity = candidate.resolvedIdentity as Record<string, unknown> | null | undefined;
  let resolvedIdentity: ResolvedDeliveryIdentity | null = null;
  if (typeof rawIdentity === "object" && rawIdentity !== null) {
    const { recipientId, capabilityId } = rawIdentity;
    if (typeof recipientId === "string" && isValidCanonical16ByteToken(recipientId) && typeof capabilityId === "string" && isValidCanonical16ByteToken(capabilityId)) {
      resolvedIdentity = { recipientId, capabilityId };
    }
  }

  return { kind: "intent", intent: { sessionId, deliveryProof, capabilitySecret }, redemptionAttemptId, resolvedIdentity };
};

export const consumePendingDeliveryIntent = (): DeliveryHashParseResult => {
  try {
    const stored = window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (stored) {
      const validated = parseStoredPendingIntent(stored);
      if (validated) return validated;
      try { window.sessionStorage.removeItem(PENDING_STORAGE_KEY); } catch { /* تجاهل */ }
    }
  } catch { /* تجاهل — سقوط احتياطي أدناه */ }
  return parseDeliveryHashFromLocation();
};

export const clearPendingDeliveryIntent = (): void => {
  try { window.sessionStorage.removeItem(PENDING_STORAGE_KEY); } catch { /* تجاهل */ }
  clearDeliveryHashFromLocation();
};

/**
 * §1-2 — يُنشئ redemptionAttemptId **مرة واحدة فقط** لكل نية معلَّقة،
 * ويُثبِّته في sessionStorage **قبل** إعادته لأي مستدعٍ. لو كان موجودًا
 * بالفعل (من محاولة سابقة/بعد refresh)، يُعاد كما هو بلا تغيير — يبقى
 * ثابتًا عبر refresh/network retry كما يتطلب backend 0029 idempotent.
 *
 * يرمي (throw) صراحة لو: صفر نية معلَّقة صالحة، أو فشلت كتابة
 * sessionStorage — **المستدعي يجب ألا يُتابِع لأي POST /redeem بعد
 * ذلك** (§2: "إذا فشل sessionStorage write: لا POST").
 */
export const ensurePendingDeliveryAttemptId = (): string => {
  const current = consumePendingDeliveryIntent();
  if (current.kind !== "intent") {
    throw new Error("no_pending_delivery_intent");
  }
  if (current.redemptionAttemptId) {
    return current.redemptionAttemptId;
  }

  const attemptId = generateCanonical16ByteToken(); // crypto.getRandomValues — صفر Math.random، صفر UUID
  const updated: DeliveryHashParseResult = { kind: "intent", intent: current.intent, redemptionAttemptId: attemptId, resolvedIdentity: current.resolvedIdentity };
  window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(updated)); // يرمي فعليًا لو فشلت الكتابة (quota إلخ) — صفر التقاط هنا عمدًا
  return attemptId;
};

/**
 * §4 — يُثبِّت هوية الخادم المُستلَمة (recipientId/capabilityId) في
 * sessionStorage **قبل** أي محاولة IndexedDB محلية قد تفشل. يتحقق أن
 * sessionId/redemptionAttemptId المُمرَّرَين يطابقان الحالة المحفوظة
 * حاليًا بالضبط — رفض آمن (M) لو لم يتطابقا (نية استُبدِلت/انتهت
 * صلاحيتها محليًا منذ الطلب). يرمي صراحة لو فشلت الكتابة أو التطابق.
 */
export const recordResolvedDeliveryIdentity = (sessionId: string, redemptionAttemptId: string, identity: ResolvedDeliveryIdentity): void => {
  const current = consumePendingDeliveryIntent();
  if (current.kind !== "intent") {
    throw new Error("no_pending_delivery_intent");
  }
  if (current.intent.sessionId !== sessionId || current.redemptionAttemptId !== redemptionAttemptId) {
    throw new Error("pending_delivery_intent_mismatch");
  }

  const updated: DeliveryHashParseResult = { kind: "intent", intent: current.intent, redemptionAttemptId, resolvedIdentity: identity };
  window.sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(updated)); // يرمي فعليًا لو فشلت الكتابة — صفر التقاط هنا عمدًا
};
