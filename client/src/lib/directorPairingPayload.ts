/**
 * PHASE NEXT-2D-C + FIX1 + FIX2 — حمولة اقتران المدير (Director Pairing Payload).
 *
 * الدلالة الأمنية المُقفَلة: الاقتران يعني **فقط** "المعلم اختار صراحةً
 * هذا المفتاح العام كوجهة تشفير لحزم مستقبلية" — صفر ادّعاء بهوية مدنية
 * موثَّقة/عضوية مدرسة/ثقة مُرسِل/تفويض. **صفر ربط بـ directorTrustRegistry.ts
 * أو resolveSenderTrust تحت أي ظرف**.
 *
 * PHASE NEXT-2D-C-FIX1: validateDirectorPairingPayload هي **مصدر التحقق
 * الوحيد** — decode/pairRecipient/confirmRecipientKeyChange تستدعيها
 * حصرًا، صفر منطق تحقق مُكرَّر/متباعد.
 *
 * PHASE NEXT-2D-C-FIX2: **encode أيضًا** يمر عبر نفس المُدقِّق الآن —
 * أمان النوع TypeScript ليس حدًّا أمنيًا وقت التشغيل عند أي حد استدعاء،
 * شاملًا نقطة *الإنشاء* لا فقط نقاط *القراءة*. encodeDirectorPairingPayload
 * تقبل `unknown`، تتحقق منه بالكامل، **وتُسلسِل حصرًا الكائن المُعاد بناؤه
 * والمُنقَّح (validation.payload)** — لا الكائن الأصلي المُمرَّر من
 * المستدعي — فحقل إضافي غير معروف لا ينجو أبدًا من التسلسل، ومادة خاصة
 * مُرفَقة بالخطأ تُرفَض قبل أي تسلسل إطلاقًا.
 */

export type DirectorPairingPayloadV1 = {
  schemaVersion: 1;
  /** بيانات توجيه عامة، دائمة، **ليست سرًّا** — قابلة للربط (linkable) لو أُعيد استخدامها عبر relay مستقبلي. */
  recipientId: string;
  directorEncryptionPublicKeyJwk: JsonWebKey;
  directorEncryptionKeyFingerprint: string;
  /** وصفي بحت، غير موثوق أمنيًا، اختياري. */
  displayName?: string;
  createdAt: string;
};

const CHUNK_SIZE = 0x8000;
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + CHUNK_SIZE)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const utf8BytesToBase64Url = (text: string): string => bytesToBase64Url(new TextEncoder().encode(text));

const base64UrlToUtf8 = (value: string): string => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/**
 * تمثيل حتمي صريح للمفتاح العام — نفس النمط المفاهيمي المُستخدَم بالفعل
 * لبصمة توقيع المعلم (teacherManifestCrypto.ts)، **مُعاد تنفيذه هنا محليًا
 * بذاته** بلا استيراد مباشر — تفادي ربط وحدة توقيع المعلم بوحدة اقتران
 * تشفير المدير، غرضان مستقلان تمامًا.
 */
const buildCanonicalPublicKeyString = (jwk: JsonWebKey): string => `EC:P-256:${jwk.x}:${jwk.y}`;

/** fingerprint كامل حتمي — SHA-256 على النص الحتمي أعلاه، مستقل عن ترتيب خصائص JWK. */
export const computeDirectorEncryptionKeyFingerprint = async (jwk: JsonWebKey): Promise<string> => {
  const bytes = new TextEncoder().encode(buildCanonicalPublicKeyString(jwk));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(hash));
};

/**
 * تمثيل عرض قصير **للعرض البصري/المقارنة السريعة فقط** — لا يجوز استخدامه
 * أبدًا كمعرِّف أمني تخزيني بذاته؛ الـfingerprint الكامل هو مصدر الحقيقة
 * الوحيد المُخزَّن والمُقارَن أمنيًا.
 */
export const formatShortFingerprintDisplay = (fullFingerprint: string): string =>
  fullFingerprint.slice(0, 12).match(/.{1,4}/g)?.join("-") ?? fullFingerprint.slice(0, 12);

/**
 * توليد recipientId عشوائي تشفيريًا (128+ بت) — مستقل تمامًا عن fingerprint
 * المفتاح، عن اسم/مدرسة، وعن أي هوية تفعيل للمدير. بيانات توجيه عامة
 * دائمة، **ليست سرًّا**.
 */
export const generateRecipientId = (): string => {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16)); // 128 بت بالضبط
  return bytesToBase64Url(randomBytes);
};

export type ValidatePairingPayloadResult =
  | { ok: true; payload: DirectorPairingPayloadV1 }
  | { ok: false; reason: string };

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * **مصدر التحقق الوحيد** — تُستدعى من decode/encode/pairRecipient/
 * confirmRecipientKeyChange على أي `unknown`، بصرف النظر عن مصدره أو
 * نوعه المُعلَن وقت الترجمة.
 *
 * fail-closed كامل: يرفض شكلًا غير كائن، schemaVersion خاطئة، recipientId
 * مفقود/فارغ، createdAt غير صالح، JWK غير EC/P-256/إحداثيات مفقودة، مادة
 * خاصة (d)، **يتحقق فعليًا عبر crypto.subtle.importKey أن الإحداثيات
 * قابلة للاستيراد فعليًا كمفتاح ECDH P-256 حقيقي**، وأخيرًا **يُعيد حساب
 * fingerprint من الـJWK نفسه ويطابقه حرفيًا** — صفر ثقة بأي fingerprint
 * مُرفَق دون إعادة اشتقاقه فعليًا. الكائن المُعاد (`payload`) **مُعاد
 * بناؤه من الصفر** من الحقول المُتحقَّق منها فقط — أي حقل إضافي غير
 * معروف في المُدخَل الأصلي لا ينجو أبدًا إلى الناتج.
 */
export const validateDirectorPairingPayload = async (input: unknown): Promise<ValidatePairingPayloadResult> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "not_an_object" };
  }
  const candidate = input as Record<string, unknown>;

  if (candidate.schemaVersion !== 1) return { ok: false, reason: "unsupported_schema" };
  if (!isNonEmptyString(candidate.recipientId)) return { ok: false, reason: "invalid_recipient_id" };
  if (!isNonEmptyString(candidate.createdAt) || Number.isNaN(new Date(candidate.createdAt).getTime())) {
    return { ok: false, reason: "invalid_created_at" };
  }

  const jwk = candidate.directorEncryptionPublicKeyJwk;
  if (typeof jwk !== "object" || jwk === null || Array.isArray(jwk)) return { ok: false, reason: "invalid_public_key_shape" };
  const jwkRecord = jwk as Record<string, unknown>;
  if (jwkRecord.kty !== "EC") return { ok: false, reason: "invalid_key_type" };
  if (jwkRecord.crv !== "P-256") return { ok: false, reason: "invalid_curve" };
  if (!isNonEmptyString(jwkRecord.x) || !isNonEmptyString(jwkRecord.y)) return { ok: false, reason: "missing_coordinates" };
  if ("d" in jwkRecord) return { ok: false, reason: "private_key_material_present" };

  if (!isNonEmptyString(candidate.directorEncryptionKeyFingerprint)) return { ok: false, reason: "missing_fingerprint" };

  // PHASE NEXT-2D-C-FIX2: مفتاح عام مُعاد بناؤه من الحقول المُتحقَّق منها
  // فقط (x/y/kty/crv) — لا jwkRecord الخام (قد يحمل حقولًا إضافية غير متوقَّعة).
  const publicKeyJwk: JsonWebKey = { kty: "EC", crv: "P-256", x: jwkRecord.x, y: jwkRecord.y };

  try {
    await crypto.subtle.importKey("jwk", publicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  } catch {
    return { ok: false, reason: "unimportable_public_key" };
  }

  const recomputedFingerprint = await computeDirectorEncryptionKeyFingerprint(publicKeyJwk);
  if (recomputedFingerprint !== candidate.directorEncryptionKeyFingerprint) {
    return { ok: false, reason: "fingerprint_mismatch" };
  }

  if (candidate.displayName !== undefined && typeof candidate.displayName !== "string") {
    return { ok: false, reason: "invalid_display_name" };
  }

  const payload: DirectorPairingPayloadV1 = {
    schemaVersion: 1,
    recipientId: candidate.recipientId,
    directorEncryptionPublicKeyJwk: publicKeyJwk,
    directorEncryptionKeyFingerprint: candidate.directorEncryptionKeyFingerprint,
    createdAt: candidate.createdAt,
    ...(typeof candidate.displayName === "string" ? { displayName: candidate.displayName } : {}),
  };
  return { ok: true, payload };
};

export type EncodePairingPayloadResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

/**
 * PHASE NEXT-2D-C-FIX2: يمر عبر validateDirectorPairingPayload **قبل** أي
 * تسلسل — يقبل `unknown` (لا `DirectorPairingPayloadV1` مباشرة، أمان
 * النوع وحده لا يمنع مستدعيًا من تمرير كائن مُزوَّر/مُشوَّه). يُسلسِل
 * **حصرًا** `validation.payload` المُعاد بناؤه — الكائن الأصلي المُمرَّر
 * لا يُسلسَل أبدًا مباشرة، فحقل إضافي غير معروف لا ينجو، ومادة خاصة/
 * fingerprint مُزوَّر يُرفَضان قبل أي تسلسل إطلاقًا. async بسبب
 * WebCrypto import/fingerprint داخل المُدقِّق.
 */
export const encodeDirectorPairingPayload = async (payload: unknown): Promise<EncodePairingPayloadResult> => {
  const validation = await validateDirectorPairingPayload(payload);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  return { ok: true, token: utf8BytesToBase64Url(JSON.stringify(validation.payload)) };
};

export type DecodePairingPayloadResult = ValidatePairingPayloadResult;

/** فك base64url/JSON ثم تفويض التحقق الكامل لـvalidateDirectorPairingPayload — صفر منطق تحقق مُكرَّر. */
export const decodeDirectorPairingPayload = async (token: string): Promise<DecodePairingPayloadResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlToUtf8(token));
  } catch {
    return { ok: false, reason: "malformed_encoding" };
  }
  return validateDirectorPairingPayload(parsed);
};
