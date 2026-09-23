// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptZipForDirector, decryptEnvelopeWithSharedSecretBits, decryptEnvelopeAsCurrentDirector, type EncryptedEnvelopeV1 } from "./directRelayEnvelope";
import { getOrCreateDirectorEncryptionPublicKey } from "./directorEncryptionIdentity";

const DB_NAME = "khabir-director-encryption-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

const generateEcdhKeyPair = () => crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

/**
 * محاكاة اشتقاق سر مُشتَرَك من طرف "مدير تجريبي" — نفس خطوة ECDH التي
 * تُنفِّذها directorEncryptionIdentity.ts داخليًا، لكن بمفتاح تجريبي مُولَّد
 * مباشرة هنا (بمعزل تام عن أي مفتاح إنتاجي مُخزَّن في IndexedDB).
 */
const deriveTestSharedSecretBits = (directorPrivateKey: CryptoKey, ephemeralPublicKeyJwk: JsonWebKey) => (async () => {
  const ephemeralPublicKey = await crypto.subtle.importKey("jwk", ephemeralPublicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveBits({ name: "ECDH", public: ephemeralPublicKey }, directorPrivateKey, 256);
})();

describe("PHASE NEXT-2C: directRelayEnvelope — تشفير/فك تشفير E2E (طبقة منخفضة المستوى، بمعزل عن أي مفتاح إنتاجي)", () => {
  it("1) encrypt→decrypt يُعيد نفس bytes الأصلية byte-for-byte", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const zipBytes = new TextEncoder().encode("PK\x03\x04fake-zip-content-بيانات-حقيقية-123456");

    const envelope = await encryptZipForDirector(zipBytes, directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const result = await decryptEnvelopeWithSharedSecretBits(envelope, sharedSecretBits);

    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.zipBytes)).toEqual(Buffer.from(zipBytes));
  });

  it("4) ephemeral private key لا يظهر في envelope إطلاقًا", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test"), directorPublicJwk);
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("CryptoKey");
    expect(envelope.ephemeralPublicKeyJwk.d).toBeUndefined();
  });

  it("5) tampered ciphertext يفشل فك التشفير (fail-closed)", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test-content"), directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const tampered: EncryptedEnvelopeV1 = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -4) + "AAAA" };
    const result = await decryptEnvelopeWithSharedSecretBits(tampered, sharedSecretBits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("decryption_failed");
  });

  it("6) مفتاح مدير آخر (سر مُشتَرَك مختلف تمامًا) يفشل فك التشفير", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const wrongDirectorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test-content"), directorPublicJwk);
    const wrongSharedSecretBits = await deriveTestSharedSecretBits(wrongDirectorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const result = await decryptEnvelopeWithSharedSecretBits(envelope, wrongSharedSecretBits);
    expect(result.ok).toBe(false);
  });

  it("7) tampered IV يفشل فك التشفير", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test-content"), directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const tampered: EncryptedEnvelopeV1 = { ...envelope, iv: envelope.iv.slice(0, -2) + "zz" };
    const result = await decryptEnvelopeWithSharedSecretBits(tampered, sharedSecretBits);
    expect(result.ok).toBe(false);
  });

  it("8) tampered salt يفشل فك التشفير (مفتاح مُشتَق مختلف)", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test-content"), directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const tampered: EncryptedEnvelopeV1 = { ...envelope, salt: envelope.salt.slice(0, -2) + "zz" };
    const result = await decryptEnvelopeWithSharedSecretBits(tampered, sharedSecretBits);
    expect(result.ok).toBe(false);
  });

  it("9) schemaVersion غير معروف يُرفَض قبل أي محاولة فك تشفير", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test-content"), directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const malformed = { ...envelope, schemaVersion: 2 as unknown as 1 };
    const result = await decryptEnvelopeWithSharedSecretBits(malformed, sharedSecretBits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_schema");
  });

  it("10) صفر استخدام فعلي لأي signing private key (ECDSA)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directRelayEnvelope.ts"), "utf-8");
    expect(source).not.toContain('name: "ECDSA"');
    expect(source).not.toMatch(/^import .*teacherManifestCrypto/m);
    expect(source).not.toContain("signCanonicalManifest(");
  });

  it("11) صفر network/API calls — بحث بنيوي في مصدر الملف", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directRelayEnvelope.ts"), "utf-8");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("XMLHttpRequest");
    expect(source).not.toContain("WebSocket");
    expect(source).not.toMatch(/await import\(["']http/);
  });

  it("12) envelope النهائي لا يحتوي أي مرجع مفتاح خاص أو سر مُشتَرَك", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("test"), directorPublicJwk);
    expect(Object.keys(envelope).sort()).toEqual(["ciphertext", "ephemeralPublicKeyJwk", "iv", "salt", "schemaVersion"]);
  });

  it("13) تشفيران متتاليان لنفس ZIP ونفس مفتاح المدير ينتجان ciphertext مختلفًا (ephemeral key/salt/IV عشوائيان)", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const zipBytes = new TextEncoder().encode("same-zip-content");
    const envelope1 = await encryptZipForDirector(zipBytes, directorPublicJwk);
    const envelope2 = await encryptZipForDirector(zipBytes, directorPublicJwk);
    expect(envelope1.ciphertext).not.toBe(envelope2.ciphertext);
    expect(envelope1.salt).not.toBe(envelope2.salt);
    expect(envelope1.iv).not.toBe(envelope2.iv);
    expect(envelope1.ephemeralPublicKeyJwk.x).not.toBe(envelope2.ephemeralPublicKeyJwk.x);

    const sharedSecretBits1 = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope1.ephemeralPublicKeyJwk);
    const sharedSecretBits2 = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope2.ephemeralPublicKeyJwk);
    const result1 = await decryptEnvelopeWithSharedSecretBits(envelope1, sharedSecretBits1);
    const result2 = await decryptEnvelopeWithSharedSecretBits(envelope2, sharedSecretBits2);
    expect(result1.ok && result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(Buffer.from(result1.zipBytes)).toEqual(Buffer.from(zipBytes));
      expect(Buffer.from(result2.zipBytes)).toEqual(Buffer.from(zipBytes));
    }
  });

  it("14) decrypt يُعيد Uint8Array فقط بعد نجاح AES-GCM authentication فعليًا", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const envelope = await encryptZipForDirector(new TextEncoder().encode("real-content"), directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const result = await decryptEnvelopeWithSharedSecretBits(envelope, sharedSecretBits);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.zipBytes).toBeInstanceOf(Uint8Array);
  });

  it("15) [FIX1] AAD صحيح ينجح؛ AAD خاطئ يفشل فك التشفير فعليًا عبر AES-GCM authentication — لا محاكاة عبر tampered ciphertext", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);
    const zipBytes = new TextEncoder().encode("aad-test-content");
    const envelope = await encryptZipForDirector(zipBytes, directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);

    const toBytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), "=")), (c) => c.charCodeAt(0));
    const salt = toBytes(envelope.salt);
    const iv = toBytes(envelope.iv);
    const ciphertext = toBytes(envelope.ciphertext);
    const hkdfKeyMaterial = await crypto.subtle.importKey("raw", sharedSecretBits, "HKDF", false, ["deriveKey"]);
    const contentKey = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("khabir-direct-relay-v1") },
      hkdfKeyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
    );

    const correctPlaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("khabir-direct-relay-envelope-v1") },
      contentKey, ciphertext as BufferSource,
    );
    expect(Buffer.from(new Uint8Array(correctPlaintext))).toEqual(Buffer.from(zipBytes));

    await expect(
      crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("wrong-aad-value") },
        contentKey, ciphertext as BufferSource,
      ),
    ).rejects.toThrow();
  });
  it("[FIX-LARGE-PAYLOAD] payload كبير (2 MiB+1 بايت، ليس مضربًا تامًا لـCHUNK_SIZE) — encrypt/decrypt ينجح byte-for-byte عبر bytesToBase64Url chunked الفعلية", async () => {
    const directorKeyPair = await generateEcdhKeyPair();
    const directorPublicJwk = await crypto.subtle.exportKey("jwk", directorKeyPair.publicKey);

    const size = 2 * 1024 * 1024 + 1;
    const largeZipBytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) largeZipBytes[i] = (i * 2654435761) % 256;

    const envelope = await encryptZipForDirector(largeZipBytes, directorPublicJwk);
    const sharedSecretBits = await deriveTestSharedSecretBits(directorKeyPair.privateKey, envelope.ephemeralPublicKeyJwk);
    const result = await decryptEnvelopeWithSharedSecretBits(envelope, sharedSecretBits);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.zipBytes.length).toBe(size);
      expect(Buffer.from(result.zipBytes)).toEqual(Buffer.from(largeZipBytes));
    }
  });
});

describe("PHASE NEXT-2C-API-BOUNDARY: decryptEnvelopeAsCurrentDirector — end-to-end عبر IndexedDB test implementation (fake-indexeddb)", () => {
  it("D) encrypt بمفتاح المدير المُخزَّن الحالي → decrypt عبر الهوية المُخزَّنة (IndexedDB test implementation / fake-indexeddb) → نفس ZIP byte-for-byte", async () => {
    const directorPublicJwk = await getOrCreateDirectorEncryptionPublicKey();
    const zipBytes = new TextEncoder().encode("real-e2e-current-director-content-1234567890");

    const envelope = await encryptZipForDirector(zipBytes, directorPublicJwk);
    const result = await decryptEnvelopeAsCurrentDirector(envelope);

    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.zipBytes)).toEqual(Buffer.from(zipBytes));
  });

  it("F) wrong/tampered ephemeral public key يفشل fail-closed عبر decryptEnvelopeAsCurrentDirector", async () => {
    const directorPublicJwk = await getOrCreateDirectorEncryptionPublicKey();
    const envelope = await encryptZipForDirector(new TextEncoder().encode("content"), directorPublicJwk);
    const tampered: EncryptedEnvelopeV1 = { ...envelope, ephemeralPublicKeyJwk: { ...envelope.ephemeralPublicKeyJwk, x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } };
    const result = await decryptEnvelopeAsCurrentDirector(tampered);
    expect(result.ok).toBe(false);
  });

  it("H) sharedSecretBits لا يُكتب في IndexedDB (صفر مخزن/سجل جديد يظهر بعد الاستدعاء غير مخزن المفتاح نفسه)", async () => {
    const directorPublicJwk = await getOrCreateDirectorEncryptionPublicKey();
    const envelope = await encryptZipForDirector(new TextEncoder().encode("content"), directorPublicJwk);
    await decryptEnvelopeAsCurrentDirector(envelope);

    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
    });
    expect(Array.from(database.objectStoreNames)).toEqual(["encryptionKeyPair"]); // صفر مخزن إضافي لأي سر مُشتَرَك
    database.close();
  });

  it("H) sharedSecretBits لا يظهر في أي console.log/تسلسل يمكن رصده عبر envelope النهائي (صفر تسريب في القيمة المُعادة)", async () => {
    const directorPublicJwk = await getOrCreateDirectorEncryptionPublicKey();
    const envelope = await encryptZipForDirector(new TextEncoder().encode("content"), directorPublicJwk);
    const result = await decryptEnvelopeAsCurrentDirector(envelope);
    expect(JSON.stringify(result)).not.toContain("sharedSecret");
  });

  it("E) استدعاء decryptEnvelopeAsCurrentDirector مرتين لنفس envelope ناجح في كل مرة (الهوية تُشتَق من جديد بأمان، صفر حالة عالقة)", async () => {
    const directorPublicJwk = await getOrCreateDirectorEncryptionPublicKey();
    const zipBytes = new TextEncoder().encode("repeatable-content");
    const envelope = await encryptZipForDirector(zipBytes, directorPublicJwk);
    const first = await decryptEnvelopeAsCurrentDirector(envelope);
    const second = await decryptEnvelopeAsCurrentDirector(envelope);
    expect(first.ok && second.ok).toBe(true);
  });
});
