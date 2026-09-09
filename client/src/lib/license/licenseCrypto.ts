import type { LicensePayload, SignedEntitlementPayload } from "./licenseTypes";

/**
 * تحقق محلي وغير متصل من توقيع كود الترخيص، باستخدام توقيع رقمي غير متماثل
 * (ECDSA على المنحنى P-256 مع SHA-256) عبر Web Crypto القياسي في المتصفح.
 *
 * هذا الملف يحتوي منطق "التحقق" فقط (Public Key). لا يحتوي ولا يستورد أي
 * مفتاح خاص. أداة توليد وتوقيع الأكواد منفصلة تمامًا وتعمل خارج هذا التطبيق
 * (راجع scripts/license-tools/).
 *
 * تنسيق كود التفعيل: base64url(JSON payload) + "." + base64url(signature)
 *
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 */

const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const HASH_ALGORITHM = { name: "ECDSA", hash: "SHA-256" } as const;

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export type ParsedLicenseCode = {
  payloadBytes: Uint8Array;
  payloadText: string;
  signatureBytes: Uint8Array;
};

/** يفصل كود التفعيل إلى المحتوى والتوقيع دون أي تحقق تشفيري بعد. */
export const parseLicenseCode = (code: string): ParsedLicenseCode | null => {
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

const isLicensePayloadShape = (value: unknown): value is LicensePayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LicensePayload>;
  return candidate.v === 1
    && typeof candidate.licenseId === "string" && candidate.licenseId.length > 0
    && (candidate.scope === "teacher" || candidate.scope === "director" || candidate.scope === "both")
    && typeof candidate.issuedAt === "string" && !Number.isNaN(new Date(candidate.issuedAt).getTime())
    && typeof candidate.expiresAt === "string" && !Number.isNaN(new Date(candidate.expiresAt).getTime());
};

/** يستورد مفتاحًا عامًا بصيغة JWK لاستخدامه في التحقق فقط (لا يقبل مفاتيح خاصة). */
export const importLicensePublicKey = (publicKeyJwk: JsonWebKey): Promise<CryptoKey> =>
  crypto.subtle.importKey("jwk", publicKeyJwk, SIGNING_ALGORITHM, false, ["verify"]);

export type LicenseCodeVerification =
  | { ok: true; payload: LicensePayload }
  | { ok: false; error: "malformed" | "invalid_signature" | "invalid_payload" };

/**
 * يتحقق من توقيع كود التفعيل مقابل مفتاح عام معطى، ويعيد المحتوى الموقَّع
 * فقط إذا كان التوقيع صحيحًا وبنية المحتوى سليمة. عملية محلية بالكامل،
 * لا تحتاج اتصال شبكة.
 */
export const verifyLicenseCode = async (code: string, publicKeyJwk: JsonWebKey): Promise<LicenseCodeVerification> => {
  const parsed = parseLicenseCode(code);
  if (!parsed) return { ok: false, error: "malformed" };

  let publicKey: CryptoKey;
  try {
    publicKey = await importLicensePublicKey(publicKeyJwk);
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

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(parsed.payloadText);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }
  if (!isLicensePayloadShape(parsedPayload)) return { ok: false, error: "invalid_payload" };

  return { ok: true, payload: parsedPayload };
};

export const licenseCryptoInternal = { base64UrlToBytes, bytesToBase64Url };

/**
 * PHASE LIC-6A: تحقق مُنفصل تمامًا لبيانات اعتماد entitlement موقَّعة v:2
 * (تجربة أو مدفوع). يُعيد استخدام parseLicenseCode/importLicensePublicKey
 * الموجودتين حرفيًا (عامتان صرفتان، بلا أي افتراض عن بنية المحتوى) — صفر
 * تعديل على verifyLicenseCode/isLicensePayloadShape v:1 القديمتين. فحص
 * الشكل يتحقق v===2 صراحة أولًا، فيرفض أي حمولة v:1 القديمة تلقائيًا بلا
 * أي لبس أو قبول متبادل.
 */
const validEntitlementKinds: readonly SignedEntitlementPayload["kind"][] = ["trial", "paid"];
const validEntitlementScopes: readonly SignedEntitlementPayload["scope"][] = ["teacher", "director", "both"];

const isSignedEntitlementPayloadShape = (value: unknown): value is SignedEntitlementPayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SignedEntitlementPayload>;
  return candidate.v === 2
    && typeof candidate.entitlementId === "string" && candidate.entitlementId.length > 0
    && typeof candidate.accountId === "string" && candidate.accountId.length > 0
    && typeof candidate.kind === "string" && validEntitlementKinds.includes(candidate.kind as SignedEntitlementPayload["kind"])
    && typeof candidate.scope === "string" && validEntitlementScopes.includes(candidate.scope as SignedEntitlementPayload["scope"])
    && typeof candidate.issuedAt === "string" && !Number.isNaN(new Date(candidate.issuedAt).getTime())
    && typeof candidate.expiresAt === "string" && !Number.isNaN(new Date(candidate.expiresAt).getTime());
};

export type SignedEntitlementVerification =
  | { ok: true; payload: SignedEntitlementPayload }
  | { ok: false; error: "malformed" | "invalid_signature" | "invalid_payload" | "unknown_version" };

/**
 * يتحقق من توقيع بيانات اعتماد entitlement v:2 مقابل مفتاح عام معطى. نفس
 * تسلسل verifyLicenseCode بالضبط (تحليل → تحقق توقيع على البايتات الخام
 * أولًا → JSON.parse بعد نجاح التوقيع فقط → فحص شكل صريح) — عملية محلية
 * بالكامل، لا اتصال شبكة.
 */
export const verifySignedEntitlementCode = async (code: string, publicKeyJwk: JsonWebKey): Promise<SignedEntitlementVerification> => {
  const parsed = parseLicenseCode(code);
  if (!parsed) return { ok: false, error: "malformed" };

  let publicKey: CryptoKey;
  try {
    publicKey = await importLicensePublicKey(publicKeyJwk);
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

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(parsed.payloadText);
  } catch {
    return { ok: false, error: "invalid_payload" };
  }

  if (typeof parsedPayload === "object" && parsedPayload !== null && "v" in parsedPayload && (parsedPayload as { v: unknown }).v !== 2) {
    return { ok: false, error: "unknown_version" };
  }
  if (!isSignedEntitlementPayloadShape(parsedPayload)) return { ok: false, error: "invalid_payload" };

  return { ok: true, payload: parsedPayload };
};
