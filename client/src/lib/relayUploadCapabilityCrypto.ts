/**
 * PHASE NEXT-2E-B2-A2-B — helper تشفيري صغير مشترك لكل رموز relay
 * العشوائية (capabilityId/capabilitySecret/sessionId/deliveryProof) —
 * جميعها تتبع نفس النمط: N بايت خام عشوائي → base64url canonical،
 * واختياريًا SHA-256 على **البايتات الخام** (لا النص UTF-8 للتمثيل
 * المُرمَّز) لإنتاج verifier. مشترك عمدًا لتفادي تكرار نفس المنطق
 * أربع مرات — **مستقل تمامًا** عن أي وحدة تشفير أخرى في المشروع
 * (directorEncryptionIdentity.ts وdirectorRelayAuthIdentity.ts تبقيان
 * بلا أي استيراد لهذا الملف أو العكس).
 */

const CHUNK_SIZE = 0x8000;
const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + CHUNK_SIZE)));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

/**
 * فك ترميز صارم + تحقق round-trip canonical + طول بايت دقيق — نفس نمط
 * decodeCanonicalBase64UrlExactLength في backend's relaySignedRequestVerifier.mjs
 * (مطابقة مقصودة للعقد، لا استيراد فعلي بين مشروعين منفصلين).
 */
export const decodeCanonicalBase64UrlExactLength = (value: string, expectedByteLength: number): Uint8Array | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let bytes: Uint8Array;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes.length !== expectedByteLength) return null;
  if (bytesToBase64Url(bytes) !== value) return null; // round-trip صارم
  return bytes;
};

/** 16 بايت خام عشوائي → 22 حرفًا canonical (recipientId/capabilityId/sessionId). */
export const generateCanonical16ByteToken = (): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));

/** 32 بايت خام عشوائي → 43 حرفًا canonical (capabilitySecret/deliveryProof). */
export const generateCanonical32ByteToken = (): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/**
 * verifier = base64url(SHA-256(raw decoded 32-byte token bytes)) —
 * **حصرًا** على البايتات الخام المُفكَّكة، **ليس** على النص UTF-8
 * للتمثيل المُرمَّز بـbase64url. يرمي لو الطول بعد الفك ليس 32 بايت
 * بالضبط (fail-closed — استدعاء بمُدخَل غير صالح خطأ برمجي، لا حالة
 * تشغيلية يجب التعامل معها بصمت).
 */
export const computeRawSha256Verifier = async (canonical32ByteToken: string): Promise<string> => {
  const rawBytes = decodeCanonicalBase64UrlExactLength(canonical32ByteToken, 32);
  if (!rawBytes) throw new Error("invalid_32_byte_canonical_token");
  const digest = await crypto.subtle.digest("SHA-256", rawBytes as BufferSource);
  return bytesToBase64Url(new Uint8Array(digest));
};

export const isValidCanonical16ByteToken = (value: unknown): value is string =>
  typeof value === "string" && decodeCanonicalBase64UrlExactLength(value, 16) !== null;

export const isValidCanonical32ByteToken = (value: unknown): value is string =>
  typeof value === "string" && decodeCanonicalBase64UrlExactLength(value, 32) !== null;
