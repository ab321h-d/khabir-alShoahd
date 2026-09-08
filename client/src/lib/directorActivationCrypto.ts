/**
 * PHASE ID-2A.1: تحقق توقيع بيانات اعتماد تفعيل المدير — ECDSA P-256/SHA-256
 * عبر Web Crypto القياسي. مستقل تمامًا عن license/licenseCrypto.ts (لا
 * استيراد منه ولا إليه) — نفس النمط التشفيري لأنه مُختبَر أصلًا في هذا
 * المشروع، لا مشاركة كود أو حالة. هذا الملف يحتوي منطق "التحقق" فقط (مفتاح
 * عام)؛ لا يحتوي ولا يستورد أي مفتاح خاص إطلاقًا.
 *
 * تنسيق بيانات الاعتماد: base64url(JSON payload) + "." + base64url(signature)
 */

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const HASH_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export type ParsedActivationCredential = {
  payloadBytes: Uint8Array;
  payloadText: string;
  signatureBytes: Uint8Array;
};

/** يفصل بيانات الاعتماد إلى المحتوى والتوقيع دون أي تحقق تشفيري بعد. */
export const parseActivationCredential = (code: string): ParsedActivationCredential | null => {
  const trimmed = code.trim();
  const separatorIndex = trimmed.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) return null;
  try {
    const payloadPart = trimmed.slice(0, separatorIndex);
    const signaturePart = trimmed.slice(separatorIndex + 1);
    const payloadBytes = base64UrlToBytes(payloadPart);
    const signatureBytes = base64UrlToBytes(signaturePart);
    const payloadText = new TextDecoder().decode(payloadBytes);
    return { payloadBytes, payloadText, signatureBytes };
  } catch {
    return null;
  }
};

/** يستورد مفتاحًا عامًا بصيغة JWK للتحقق فقط — يرفض أي مفتاح خاص (usages: ["verify"] فقط). */
export const importActivationPublicKey = (publicKeyJwk: JsonWebKey): Promise<CryptoKey> =>
  crypto.subtle.importKey("jwk", publicKeyJwk, SIGNING_ALGORITHM, false, ["verify"]);

/** يتحقق من التوقيع فقط (بلا فحص بنية/شكل payload — تلك مسؤولية الطبقة الأعلى في directorActivation.ts). */
export const verifyActivationSignature = async (code: string, publicKeyJwk: JsonWebKey): Promise<{ ok: true; payloadText: string } | { ok: false; error: "malformed" | "invalid_signature" }> => {
  const parsed = parseActivationCredential(code);
  if (!parsed) return { ok: false, error: "malformed" };

  let publicKey: CryptoKey;
  try {
    publicKey = await importActivationPublicKey(publicKeyJwk);
  } catch {
    return { ok: false, error: "malformed" };
  }

  let signatureValid = false;
  try {
    signatureValid = await crypto.subtle.verify(HASH_ALGORITHM, publicKey, parsed.signatureBytes as BufferSource, parsed.payloadBytes as BufferSource);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, error: "invalid_signature" };

  return { ok: true, payloadText: parsed.payloadText };
};
