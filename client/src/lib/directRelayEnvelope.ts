/**
 * PHASE NEXT-2C + PHASE NEXT-2C-API-BOUNDARY — طبقة تشفير الحزمة من طرف
 * إلى طرف (E2E) بين المعلم والمدير. **مستقلة تمامًا** عن teacherManifestCrypto.ts
 * (توقيع/تحقق manifest المعلم) — صفر إعادة استخدام لمفتاح توقيع كمفتاح
 * تشفير، صفر تعديل على تلك الوحدة. helper base64url أدناه مستقل بذاته
 * عمدًا (القرار المُوثَّق: bytesToBase64Url/base64UrlToBytes في
 * teacherManifestCrypto.ts غير مُصدَّرتين — إضافة export لهما فقط لهذا
 * الغرض كانت ستخلق coupling غير مبرَّر بين طبقة توقيع manifest وطبقة
 * تشفير النقل، فتم تجنُّبه).
 *
 * PHASE NEXT-2C-API-BOUNDARY: هذا الملف **لا يحمل أي مرجع لمفتاح خاص
 * إنتاجي مُخزَّن إطلاقًا** — دوال فك التشفير تقبل إما sharedSecretBits
 * جاهزة (طبقة منخفضة المستوى، قابلة للاختبار بمعزل تام) أو تُفوِّض
 * اشتقاقه لـdirectorEncryptionIdentity.ts (الملف الوحيد المالك للمفتاح
 * الخاص في كل المشروع).
 *
 * هذه طبقة تأسيسية محلية بحتة — صفر شبكة/backend/pairing/QR. الهدف:
 * ZIP الأصلي → تشفير → Encrypted Envelope → فك تشفير → نفس ZIP byte-for-byte.
 */
import { deriveDirectorSharedSecretBits } from "./directorEncryptionIdentity";

export type EncryptedEnvelopeV1 = {
  schemaVersion: 1;
  ephemeralPublicKeyJwk: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
};

/** domain/version binding منفصلان عمدًا — HKDF info لاشتقاق المفتاح، AES-GCM AAD لربط السياق أثناء التشفير نفسه. */
const HKDF_INFO = "khabir-direct-relay-v1";
const AAD_STRING = "khabir-direct-relay-envelope-v1";

/**
 * PHASE NEXT-2C-LARGE-PAYLOAD: chunked لتفادي تجاوز الحد الأقصى لعدد
 * وسائط الدالة (String.fromCharCode(...bytes)) — خطر حقيقي لحزم كبيرة
 * (ciphertext يقارب حجم ZIP نفسه). CHUNK_SIZE=0x8000 (32768) قيمة آمنة
 * قياسية شائعة الاستخدام لهذا النمط، دون أي تأثير على القيمة النهائية.
 */
const CHUNK_SIZE = 0x8000;
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + CHUNK_SIZE)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

/**
 * يشتق مفتاح AES-GCM-256 من سر ECDH مُشتَرَك جاهز (ArrayBuffer خام) عبر
 * HKDF-SHA-256. salt عشوائي تشفيريًا (crypto.getRandomValues) — **ليس**
 * exportId أو أي قيمة قابلة للتنبؤ.
 */
const deriveContentEncryptionKey = async (sharedSecretBits: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> => {
  const hkdfKeyMaterial = await crypto.subtle.importKey("raw", sharedSecretBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(HKDF_INFO) },
    hkdfKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/**
 * تشفير (جانب المعلم) — ephemeral ECDH keypair جديد لكل استدعاء (صفر
 * إعادة استخدام)، salt/IV عشوائيان تشفيريًا لكل استدعاء. المفتاح الخاص
 * العابر **لا يُغادر هذه الدالة إطلاقًا**. المعلم لا يملك أي هوية مُخزَّنة
 * هنا — يستورد فقط المفتاح العام للمدير كمعامل، فهذا الجانب لا يتأثر
 * بحدود API الجديدة في directorEncryptionIdentity.ts.
 */
export const encryptZipForDirector = async (zipBytes: Uint8Array, directorPublicKeyJwk: JsonWebKey): Promise<EncryptedEnvelopeV1> => {
  const directorPublicKey = await crypto.subtle.importKey("jwk", directorPublicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeralKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const ephemeralPublicKeyJwk = await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM: 96-bit/12 بايت قياسي

  const sharedSecretBits = await crypto.subtle.deriveBits({ name: "ECDH", public: directorPublicKey }, ephemeralKeyPair.privateKey, 256);
  const contentKey = await deriveContentEncryptionKey(sharedSecretBits, salt);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(AAD_STRING) },
    contentKey,
    zipBytes as BufferSource,
  );

  return {
    schemaVersion: 1,
    ephemeralPublicKeyJwk,
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertextBuffer)),
  };
};

export type DecryptEnvelopeResult =
  | { ok: true; zipBytes: Uint8Array }
  | { ok: false; reason: "unknown_schema" | "decryption_failed" };

/**
 * PHASE NEXT-2C-API-BOUNDARY — طبقة منخفضة المستوى: تقبل sharedSecretBits
 * **جاهزة من الخارج**، صفر معرفة بـIndexedDB أو directorEncryptionIdentity.ts
 * — قابلة للاختبار بمعزل تام بمفاتيح تجريبية مُولَّدة مباشرة (كما كانت
 * الاختبارات الحالية تفعل بالضبط، بلا أي تغيير جوهري في نمط الاختبار).
 * fail-closed كامل عبر try/catch شامل — أي فشل مصادقة AES-GCM (تلاعب بأي
 * حقل: ciphertext/IV/salt/AAD، أو سر مُشتَرَك خاطئ) يُعامَل كفشل صريح.
 */
export const decryptEnvelopeWithSharedSecretBits = async (envelope: EncryptedEnvelopeV1, sharedSecretBits: ArrayBuffer): Promise<DecryptEnvelopeResult> => {
  if (envelope.schemaVersion !== 1) {
    return { ok: false, reason: "unknown_schema" };
  }

  try {
    const salt = base64UrlToBytes(envelope.salt);
    const iv = base64UrlToBytes(envelope.iv);
    const ciphertext = base64UrlToBytes(envelope.ciphertext);

    const contentKey = await deriveContentEncryptionKey(sharedSecretBits, salt);
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(AAD_STRING) },
      contentKey,
      ciphertext as BufferSource,
    );

    return { ok: true, zipBytes: new Uint8Array(plaintextBuffer) };
  } catch {
    return { ok: false, reason: "decryption_failed" };
  }
};

/**
 * PHASE NEXT-2C-API-BOUNDARY — طبقة مُريحة لجانب المدير الفعلي: تتحقق من
 * schemaVersion أولًا، ثم تطلب اشتقاق sharedSecretBits من
 * directorEncryptionIdentity.ts (المالك الوحيد للمفتاح الخاص) باستخدام
 * envelope.ephemeralPublicKeyJwk، وتُمرِّره **مباشرة** إلى
 * decryptEnvelopeWithSharedSecretBits أعلاه — صفر تخزين لـsharedSecretBits
 * في أي مكان، صفر إدراجه في return value، صفر بقاء له بعد هذا الاستدعاء.
 */
export const decryptEnvelopeAsCurrentDirector = async (envelope: EncryptedEnvelopeV1): Promise<DecryptEnvelopeResult> => {
  if (envelope.schemaVersion !== 1) {
    return { ok: false, reason: "unknown_schema" };
  }

  try {
    const sharedSecretBits = await deriveDirectorSharedSecretBits(envelope.ephemeralPublicKeyJwk);
    return await decryptEnvelopeWithSharedSecretBits(envelope, sharedSecretBits);
  } catch {
    return { ok: false, reason: "decryption_failed" };
  }
};
