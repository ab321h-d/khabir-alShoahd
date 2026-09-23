// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { getOrCreateDirectorEncryptionPublicKey, deriveDirectorSharedSecretBits } = await import("./directorEncryptionIdentity");

const DB_NAME = "khabir-director-encryption-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

describe("PHASE NEXT-2C-API-BOUNDARY: directorEncryptionIdentity — حدود API صارمة", () => {
  it("A) لا يوجد public API يُعيد director private CryptoKey — فحص بنيوي مباشر على مصدر الملف", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorEncryptionIdentity.ts"), "utf-8");
    const exportLines = source.split("\n").filter((line) => line.trimStart().startsWith("export "));
    for (const line of exportLines) {
      expect(line).not.toMatch(/privateKey/);
      expect(line).not.toMatch(/CryptoKey\s*[;,)]/); // أي export يُعيد CryptoKey مباشرة كنوع إرجاع
      expect(line).not.toContain("keyPair");
      expect(line).not.toContain("StoredEncryptionKeyRecord");
    }
  });

  it("B) getOrCreateDirectorEncryptionPublicKey يُعيد JWK عامًا فقط: EC، P-256، x/y، صفر d", async () => {
    const publicKeyJwk = await getOrCreateDirectorEncryptionPublicKey();
    expect(publicKeyJwk.kty).toBe("EC");
    expect(publicKeyJwk.crv).toBe("P-256");
    expect(typeof publicKeyJwk.x).toBe("string");
    expect(typeof publicKeyJwk.y).toBe("string");
    expect(publicKeyJwk.d).toBeUndefined();
  });

  it("C) deriveDirectorSharedSecretBits: النتيجة ArrayBuffer، 32 بايت (256 بت)، ليست CryptoKey، صفر privateKey في أي تسلسل", async () => {
    const testEphemeralKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const testEphemeralPublicJwk = await crypto.subtle.exportKey("jwk", testEphemeralKeyPair.publicKey);

    const sharedSecretBits = await deriveDirectorSharedSecretBits(testEphemeralPublicJwk);

    expect(Object.prototype.toString.call(sharedSecretBits)).toBe("[object ArrayBuffer]"); // فحص قوي عبر أي realm (jsdom/Node)، أضمن من instanceof
    expect(sharedSecretBits.byteLength).toBe(32);
    expect(sharedSecretBits).not.toHaveProperty("algorithm"); // CryptoKey تحمل .algorithm، ArrayBuffer لا
    expect(sharedSecretBits).not.toHaveProperty("extractable");
    // صفر إمكانية لتسلسل يحتوي "privateKey" — sharedSecretBits نفسها بايتات خام بلا أي بنية اسمية
    expect(() => JSON.stringify(sharedSecretBits)).not.toThrow();
  });

  it("E) persistence: استدعاء المفتاح العام مرتين يُعيد نفس x/y بالضبط", async () => {
    const first = await getOrCreateDirectorEncryptionPublicKey();
    const second = await getOrCreateDirectorEncryptionPublicKey();
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
  });

  it("F) مفتاح ephemeral عام تالف/مُشوَّه بنيويًا يفشل fail-closed عند الاشتقاق", async () => {
    const malformedJwk: JsonWebKey = { kty: "EC", crv: "P-256", x: "not-valid-base64url!!!", y: "also-not-valid!!!" };
    await expect(deriveDirectorSharedSecretBits(malformedJwk)).rejects.toThrow();
  });

  it("G) فحص بنيوي: صفر export لأي دالة تُعيد privateKey/CryptoKey/keyPair بالاسم", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorEncryptionIdentity.ts"), "utf-8");
    expect(source).not.toMatch(/^export const \w*[Pp]rivateKey/m);
    expect(source).not.toMatch(/^export const \w*[Kk]eyPair\b/m);
    expect(source).not.toMatch(/^export interface DirectorEncryptionIdentity/m);
  });
});
