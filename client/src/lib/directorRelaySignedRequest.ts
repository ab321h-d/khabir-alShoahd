/**
 * PHASE NEXT-2E-B1B — بناء الطلب الموقَّع لـrelay المدير، متوافق حرفيًا
 * (byte-for-byte) مع relaySignedRequestVerifier.mjs الفعلية في backend
 * khabir-license-backend (commit 1587d52). helper base64url مستقل
 * بذاته عمدًا — نفس القرار المُوثَّق سابقًا (directRelayEnvelope.ts) —
 * صفر coupling بين وحدات مستقلة الغرض.
 *
 * canonical string:
 *   METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH_HEX
 */
import { signWithDirectorRelayAuthKey } from "./directorRelayAuthIdentity";

const CHUNK_SIZE = 0x8000;
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + CHUNK_SIZE)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

/** SHA-256 لبايتات body الفعلية — hex سفلي، مطابق حرفيًا لدالة الخادم sha256HashHex. */
export const sha256HashHex = async (bodyBytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bodyBytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** method مُطبَّع لأحرف كبيرة إلزاميًا هنا — مطابق حرفيًا لـbuildCanonicalSigningString في الخادم. */
export const buildCanonicalSigningString = ({ method, path, timestamp, nonce, bodyHashHex }: {
  method: string; path: string; timestamp: string; nonce: string; bodyHashHex: string;
}): string => `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHashHex}`;

/** nonce عشوائي تشفيريًا — 16 بايت خام → base64url بلا padding (22 حرفًا)، مطابق حرفيًا لعقد الخادم. */
export const generateRelayNonce = (): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));

export interface SignedRelayRequest {
  timestamp: string;
  nonce: string;
  bodyHashHex: string;
  signatureBase64Url: string;
}

/**
 * يبني طلبًا موقَّعًا كاملًا: timestamp حالي قانوني (toISOString())، nonce
 * عشوائي جديد لكل استدعاء، body hash من البايتات الفعلية المُرسَلة
 * حرفيًا (UTF-8 لنص JSON، أو سلسلة فارغة لطلب بلا جسم)، توقيع ECDSA عبر
 * signWithDirectorRelayAuthKey (صفر تسريب مفتاح خاص هنا).
 */
export const buildSignedRelayRequest = async ({ method, path, body }: { method: string; path: string; body?: string }): Promise<SignedRelayRequest> => {
  const timestamp = new Date().toISOString();
  const nonce = generateRelayNonce();
  const bodyBytes = new TextEncoder().encode(body ?? "");
  const bodyHashHex = await sha256HashHex(bodyBytes);

  const canonicalString = buildCanonicalSigningString({ method, path, timestamp, nonce, bodyHashHex });
  const signatureBytes = await signWithDirectorRelayAuthKey(new TextEncoder().encode(canonicalString));
  const signatureBase64Url = bytesToBase64Url(new Uint8Array(signatureBytes));

  return { timestamp, nonce, bodyHashHex, signatureBase64Url };
};
