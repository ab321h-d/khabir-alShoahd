// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { buildCanonicalSigningString, generateRelayNonce, sha256HashHex, buildSignedRelayRequest } = await import("./directorRelaySignedRequest");
const { getOrCreateDirectorRelayAuthPublicKey } = await import("./directorRelayAuthIdentity");

const DB_NAME = "khabir-director-relay-auth-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

/**
 * PHASE NEXT-2E-B1B/§6 — متجه توافق مستقل ذاتي (fixed compatibility
 * mechanism): إعادة تنفيذ مستقلة لمنطق verifySignedRequest الفعلي في
 * relaySignedRequestVerifier.mjs (backend)، **بلا استيراد أي مسار
 * خارجي/مستودع شقيق** — كلا الطرفين يستخدمان نفس Web Crypto API
 * القياسية (ECDSA P-256/SHA-256 على canonicalString UTF-8)، فإعادة
 * التنفيذ المستقل هنا تُثبِت التوافق فعليًا بدقة كافية.
 */
const base64UrlToBytes = (value: string): Uint8Array => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

const independentVerify = async (canonicalString: string, signatureBase64Url: string, publicKeyJwk: JsonWebKey): Promise<boolean> => {
  // إعادة بناء JWK نظيف (kty/crv/x/y فقط) — key_ops المُصدَّرة تلقائيًا من
  // WebCrypto (فارغة للمفتاح العام عند generateKey بـ["sign"] فقط) تتعارض
  // مع keyUsages=["verify"] المطلوبة صراحة هنا عند الاستيراد.
  const canonicalJwk: JsonWebKey = { kty: publicKeyJwk.kty, crv: publicKeyJwk.crv, x: publicKeyJwk.x, y: publicKeyJwk.y };
  const publicKey = await crypto.subtle.importKey("jwk", canonicalJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signatureBytes = base64UrlToBytes(signatureBase64Url);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signatureBytes, new TextEncoder().encode(canonicalString));
};

describe("PHASE NEXT-2E-B1B: directorRelaySignedRequest", () => {
  it("4) canonical string مطابق حرفيًا: METHOD\\nPATH\\nTIMESTAMP\\nNONCE\\nBODY_HASH_HEX، method مُطبَّع لأحرف كبيرة", () => {
    const result = buildCanonicalSigningString({ method: "post", path: "/relay-auth/register", timestamp: "2026-09-24T00:00:00.000Z", nonce: "abc", bodyHashHex: "def" });
    expect(result).toBe("POST\n/relay-auth/register\n2026-09-24T00:00:00.000Z\nabc\ndef");
  });

  it("5) nonce = 16 بايت خام بالضبط → 22 حرفًا base64url قانوني", () => {
    const nonce = generateRelayNonce();
    expect(nonce.length).toBe(22);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const second = generateRelayNonce();
    expect(nonce).not.toBe(second);
  });

  it("6) body hash = SHA-256 hex سفلي بطول 64 حرفًا بالضبط", async () => {
    const hash = await sha256HashHex(new TextEncoder().encode("test-body"));
    expect(hash.length).toBe(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("7) body hash يُحسَب من بايتات body الفعلية المُرسَلة حرفيًا", async () => {
    const bodyText = JSON.stringify({ a: 1 });
    const signed = await buildSignedRelayRequest({ method: "POST", path: "/relay-auth/register", body: bodyText });
    const expectedHash = await sha256HashHex(new TextEncoder().encode(bodyText));
    expect(signed.bodyHashHex).toBe(expectedHash);
  });

  it("timestamp: صيغة toISOString() القانونية الدقيقة", async () => {
    const signed = await buildSignedRelayRequest({ method: "POST", path: "/x" });
    const date = new Date(signed.timestamp);
    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.toISOString()).toBe(signed.timestamp);
  });

  it("1) توقيع الطلب الكامل raw r‖s = 64 بايت بعد فك base64url", async () => {
    const signed = await buildSignedRelayRequest({ method: "POST", path: "/relay-auth/register", body: "{}" });
    const decoded = base64UrlToBytes(signed.signatureBase64Url);
    expect(decoded.length).toBe(64);
  });

  it("2) توقيع الطلب الكامل base64url قانوني (round-trip، صفر padding)", async () => {
    const signed = await buildSignedRelayRequest({ method: "POST", path: "/relay-auth/register", body: "{}" });
    expect(signed.signatureBase64Url).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(signed.signatureBase64Url).not.toContain("=");
  });

  it("3) التوقيع الناتج يُتحقَّق منه فعليًا بشكل مستقل — تبادلية حقيقية (نفس خوارزمية WebCrypto المُستخدَمة فعليًا في الخادم)", async () => {
    const publicKeyJwk = await getOrCreateDirectorRelayAuthPublicKey();
    const method = "POST", path = "/relay-auth/register", body = JSON.stringify({ recipientId: "test-recipient-id-abcdefghij" });
    const signed = await buildSignedRelayRequest({ method, path, body });

    const canonicalString = buildCanonicalSigningString({ method, path, timestamp: signed.timestamp, nonce: signed.nonce, bodyHashHex: signed.bodyHashHex });
    const valid = await independentVerify(canonicalString, signed.signatureBase64Url, publicKeyJwk);
    expect(valid).toBe(true);
  });

  it("تلاعب بأي جزء من الحمولة بعد التوقيع يُبطِل التحقق المستقل (نفس ضمان الخادم)", async () => {
    const publicKeyJwk = await getOrCreateDirectorRelayAuthPublicKey();
    const method = "POST", path = "/relay-auth/register", body = "{}";
    const signed = await buildSignedRelayRequest({ method, path, body });

    const tamperedCanonicalString = buildCanonicalSigningString({ method: "DELETE", path, timestamp: signed.timestamp, nonce: signed.nonce, bodyHashHex: signed.bodyHashHex });
    const valid = await independentVerify(tamperedCanonicalString, signed.signatureBase64Url, publicKeyJwk);
    expect(valid).toBe(false);
  });
});
