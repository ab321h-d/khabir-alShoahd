// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { getOrCreateDirectorRelayAuthPublicKey, computeDirectorRelayAuthFingerprint, signWithDirectorRelayAuthKey } = await import("./directorRelayAuthIdentity");

const DB_NAME = "khabir-director-relay-auth-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

describe("PHASE NEXT-2E-B1B: directorRelayAuthIdentity", () => {
  it("9) public key JWK صالح ECDSA P-256، صفر مكوّن خاص (d)", async () => {
    const jwk = await getOrCreateDirectorRelayAuthPublicKey();
    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(typeof jwk.x).toBe("string");
    expect(typeof jwk.y).toBe("string");
    expect(jwk.d).toBeUndefined();
  });

  it("persistence: استدعاء المفتاح العام مرتين يُعيد نفس x/y بالضبط", async () => {
    const first = await getOrCreateDirectorRelayAuthPublicKey();
    const second = await getOrCreateDirectorRelayAuthPublicKey();
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y);
  });

  it("fingerprint حتمي، مستقل عن مفتاح التشفير (ECDH) — يُشتَق حصرًا من مفتاح relay-auth ذاته", async () => {
    const fp1 = await computeDirectorRelayAuthFingerprint();
    const fp2 = await computeDirectorRelayAuthFingerprint();
    expect(fp1).toBe(fp2);
  });

  it("1) توقيع relay-auth ينتج بايتات raw r‖s = 64 بايت بالضبط لـP-256 (لا DER)", async () => {
    const signature = await signWithDirectorRelayAuthKey(new TextEncoder().encode("probe"));
    expect(signature.byteLength).toBe(64);
  });

  it("11) الذرية: قراءة+كتابة أول تهيئة ضمن نفس متغيّر transaction الواحد (فحص بنيوي مباشر)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRelayAuthIdentity.ts"), "utf-8");
    const fnBody = source.slice(source.indexOf("const getOrCreateDirectorRelayAuthKeyPairInternal"));
    const transactionCallCount = (fnBody.match(/database\.transaction\(/g) || []).length;
    expect(transactionCallCount).toBe(1);
  });

  it("11ب) استدعاءات متزامنة (Promise.all) تُحسَم لنفس المفتاح — صفر سباق", async () => {
    const [a, b, c] = await Promise.all([
      getOrCreateDirectorRelayAuthPublicKey(),
      getOrCreateDirectorRelayAuthPublicKey(),
      getOrCreateDirectorRelayAuthPublicKey(),
    ]);
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);
  });

  it("10) صفر export يُعيد privateKey/CryptoKey/keyPair (فحص بنيوي على واجهة الملف العامة)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRelayAuthIdentity.ts"), "utf-8");
    const exportLines = source.split("\n").filter((line) => line.trimStart().startsWith("export "));
    for (const line of exportLines) {
      expect(line).not.toMatch(/privateKey/);
      expect(line).not.toContain("keyPair");
    }
  });

  it("صفر إعادة استخدام لمفتاح ECDH (directorEncryptionIdentity.ts) — فحص بنيوي: صفر استيراد له", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRelayAuthIdentity.ts"), "utf-8");
    expect(source).not.toMatch(/^import .*directorEncryptionIdentity/m);
    expect(source).toContain('name: "ECDSA"');
    expect(source).not.toContain('name: "ECDH"');
  });

  it("2) [BLOCKER-REVIEW] إثبات مباشر: السجل المُخزَّن في IndexedDB يحمل CryptoKey غير قابل للاستخراج فعليًا — exportKey('jwk') يُرفَض", async () => {
    await getOrCreateDirectorRelayAuthPublicKey(); // يضمن وجود سجل
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const storedRecord = await new Promise<{ privateKey: CryptoKey }>((resolve, reject) => {
      const tx = database.transaction("relayAuthKeyPair", "readonly");
      const getRequest = tx.objectStore("relayAuthKeyPair").get("current");
      getRequest.onsuccess = () => resolve(getRequest.result);
      getRequest.onerror = () => reject(getRequest.error);
    });
    database.close();

    // إثبات أن القيمة المُخزَّنة فعليًا CryptoKey حقيقي (لا كائن عادي/سلسلة)
    expect(storedRecord.privateKey).toBeInstanceOf(CryptoKey);
    expect(storedRecord.privateKey.type).toBe("private");
    expect(storedRecord.privateKey.algorithm.name).toBe("ECDSA");

    // الإثبات الحاسم: extractable === false فعليًا على الكائن المُخزَّن نفسه
    expect(storedRecord.privateKey.extractable).toBe(false);

    // محاولة تصدير فعلية يجب أن تُرفَض — لا افتراض، اختبار مباشر
    await expect(crypto.subtle.exportKey("jwk", storedRecord.privateKey)).rejects.toThrow();
  });
});
