/**
 * PHASE PILOT-50-F — الوحدة المشتركة الوحيدة (SHARED) لـ:
 *   - تمثيل المفتاح العام الحتمي
 *   - حساب fingerprint حتمي
 *   - بناء البايتات الحتمية القابلة للتوقيع (canonical signing bytes)
 *   - التوقيع (جانب المعلم) والتحقق (جانب المدير)
 *
 * يُستورَد من teacherSenderIdentity.ts (توقيع) وteacherIdentityImport.ts
 * (تحقق) على حد سواء — صفر تكرار لمنطق الـcanonicalization بين الجانبين،
 * مطابق تمامًا لمتطلب PILOT-50-E3/§5 المعتمد.
 *
 * PHASE PILOT-50-E3: مُصحَّحة بعد اكتشاف خلل JSON.stringify(value,
 * replacerArray) — لا يُطبَّق فقط على المستوى الأعلى، بل يُصفِّي أي حقل
 * غير مذكور في *كل* مستوى تكرار، مُحوِّلًا senderPublicKeyJwk/files إلى {}
 * فارغَين تمامًا. الحل: بناء يدوي مُسطَّح صريح، صفر JSON.stringify على أي
 * كائن متداخل إطلاقًا.
 */

export type SignedManifestV1 = {
  schemaVersion: 1;
  exportId: string;
  generatedAt: string;
  senderFingerprint: string;
  senderPublicKeyJwk: JsonWebKey;
  displayName: string;
  stage: string;
  files: {
    "portfolio.pdf": string;
    "completeness.json": string;
  };
};

/**
 * تمثيل حتمي صريح للمفتاح العام — فقط الحقول الرياضية الجوهرية لمفتاح
 * P-256 عام (kty/crv/x/y). استبعاد ext/key_ops عمدًا: حقول وصفية إضافية
 * لا تمثِّل جزءًا من هوية المفتاح الرياضية، قد تختلف بين تنفيذات/مكتبات
 * بلا تغيير في المفتاح نفسه — إدراجها في fingerprint/التوقيع قد يُبطِل
 * تطابقًا صحيحًا خطأً.
 */
export const buildCanonicalPublicKeyString = (jwk: JsonWebKey): string => `EC:P-256:${jwk.x}:${jwk.y}`;

/**
 * fingerprint حتمي — SHA-256 على النص الحتمي أعلاه، **ليس**
 * SHA-256(JSON.stringify(jwk)) (الذي يعتمد على ترتيب خصائص كائن غير
 * مضمون). base64url — نفس أسلوب الترميز المُستخدَم في كل نظام تفعيل
 * موجود بالمشروع.
 */
export const computeSenderFingerprint = async (jwk: JsonWebKey): Promise<string> => {
  const bytes = new TextEncoder().encode(buildCanonicalPublicKeyString(jwk));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(hash));
};

const bytesToBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

/**
 * البايتات الحتمية القابلة للتوقيع — بناء يدوي مُسطَّح صريح بترتيب حقول
 * ثابت. **صفر JSON.stringify على أي كائن متداخل** (السبب الجوهري لتصحيح
 * E3) — كل حقل، شامل الحقول المتداخلة (JWK وfiles)، يُستخرَج بصراحة
 * ويُدرَج يدويًا. حتمي 100%: نفس المُدخَل ينتج نفس البايتات دائمًا، بصرف
 * النظر عن جانب البناء (معلم أو مدير) أو بيئة التشغيل.
 */
export const buildCanonicalManifestBytes = (manifest: SignedManifestV1): Uint8Array => {
  const lines = [
    `v=${manifest.schemaVersion}`,
    `exportId=${manifest.exportId}`,
    `generatedAt=${manifest.generatedAt}`,
    `senderFingerprint=${manifest.senderFingerprint}`,
    `senderPublicKey=${buildCanonicalPublicKeyString(manifest.senderPublicKeyJwk)}`,
    `displayName=${manifest.displayName}`,
    `stage=${manifest.stage}`,
    `file:portfolio.pdf=${manifest.files["portfolio.pdf"]}`,
    `file:completeness.json=${manifest.files["completeness.json"]}`,
  ];
  return new TextEncoder().encode(lines.join("\n"));
};

export const sha256HexOfBytes = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** توقيع (جانب المعلم) — ECDSA P-256 / SHA-256 على البايتات الحتمية أعلاه. */
export const signCanonicalManifest = async (manifest: SignedManifestV1, privateKey: CryptoKey): Promise<string> => {
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, buildCanonicalManifestBytes(manifest));
  return bytesToBase64Url(new Uint8Array(signature));
};

export type VerifyManifestResult =
  | { ok: true }
  | { ok: false; reason: "fingerprint_mismatch" | "signature_invalid" | "malformed" };

/**
 * التحقق الثلاثي (جانب المدير) — PHASE PILOT-50-E3/§6/§7: fail-closed
 * صريح عبر try/catch شامل. **لا يكفي أي فحص منفرد** — يُستدعى من
 * teacherIdentityImport.ts، الذي يُضيف فوقه فحصَي hash الملفات الفعلية
 * (C/D من المتطلبات) بعد هذا التحقق.
 */
export const verifyManifestSignature = async (manifest: SignedManifestV1, signatureBase64Url: string): Promise<VerifyManifestResult> => {
  try {
    const recomputedFingerprint = await computeSenderFingerprint(manifest.senderPublicKeyJwk);
    if (recomputedFingerprint !== manifest.senderFingerprint) return { ok: false, reason: "fingerprint_mismatch" };

    const publicKey = await crypto.subtle.importKey("jwk", manifest.senderPublicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const signatureBytes = base64UrlToBytes(signatureBase64Url);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signatureBytes, buildCanonicalManifestBytes(manifest));
    if (!valid) return { ok: false, reason: "signature_invalid" };

    return { ok: true };
  } catch {
    // fail-closed صريح: أي استثناء (JWK غير صالح بنيويًا، توقيع مُشوَّه
    // الصيغة، إلخ) يُعامَل كفشل تحقق، لا نجاحًا جزئيًا أو استثناءً غير مُعالَج.
    return { ok: false, reason: "malformed" };
  }
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

export const isValidSignedManifestV1Shape = (value: unknown): value is SignedManifestV1 => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion !== 1) return false;
  if (typeof v.exportId !== "string" || typeof v.generatedAt !== "string") return false;
  if (typeof v.senderFingerprint !== "string" || typeof v.displayName !== "string" || typeof v.stage !== "string") return false;
  if (typeof v.senderPublicKeyJwk !== "object" || v.senderPublicKeyJwk === null) return false;
  const jwk = v.senderPublicKeyJwk as Record<string, unknown>;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") return false;
  if (typeof v.files !== "object" || v.files === null) return false;
  const files = v.files as Record<string, unknown>;
  if (typeof files["portfolio.pdf"] !== "string" || typeof files["completeness.json"] !== "string") return false;
  return true;
};
