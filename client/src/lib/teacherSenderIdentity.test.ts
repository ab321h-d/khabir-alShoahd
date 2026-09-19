// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { getOrCreateTeacherSenderIdentity, buildSignedManifestForExport } = await import("./teacherSenderIdentity");
const { computeSenderFingerprint } = await import("./teacherManifestCrypto");

const DB_NAME = "khabir-teacher-sender-identity-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});

beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

describe("PILOT-50-F KEY TESTS: teacherSenderIdentity", () => {
  it("privateKey.extractable === false", async () => {
    const identity = await getOrCreateTeacherSenderIdentity();
    expect(identity.privateKey.extractable).toBe(false);
  });

  it("publicKey قابل للتصدير (JWK صالح فعليًا)", async () => {
    const identity = await getOrCreateTeacherSenderIdentity();
    expect(identity.publicKeyJwk.kty).toBe("EC");
    expect(identity.publicKeyJwk.crv).toBe("P-256");
    expect(typeof identity.publicKeyJwk.x).toBe("string");
    expect(typeof identity.publicKeyJwk.y).toBe("string");
  });

  it("الهوية تثبت (persist) عبر إعادة فتح/استدعاء جديد لنفس القاعدة", async () => {
    const first = await getOrCreateTeacherSenderIdentity();
    const second = await getOrCreateTeacherSenderIdentity();
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.publicKeyJwk.x).toBe(first.publicKeyJwk.x);
  });

  it("نفس المفتاح => نفس fingerprint (حتمي)", async () => {
    const identity = await getOrCreateTeacherSenderIdentity();
    const recomputed = await computeSenderFingerprint(identity.publicKeyJwk);
    expect(recomputed).toBe(identity.fingerprint);
  });

  it("مفتاح مختلف => fingerprint مختلف", async () => {
    const identity = await getOrCreateTeacherSenderIdentity();
    await resetDatabase();
    const differentIdentity = await getOrCreateTeacherSenderIdentity();
    expect(differentIdentity.fingerprint).not.toBe(identity.fingerprint);
  });

  it("buildSignedManifestForExport تُعيد manifest+signature بلا أي مرجع لـCryptoKey", async () => {
    const result = await buildSignedManifestForExport({
      exportId: "exp-1", generatedAt: new Date().toISOString(), displayName: "معلم", stage: "middle",
      pdfBytes: new TextEncoder().encode("pdf-content"), completenessJsonBytes: new TextEncoder().encode("{}"),
    });
    expect(result.manifest.schemaVersion).toBe(1);
    expect(typeof result.signature).toBe("string");
    expect(JSON.stringify(result)).not.toContain("CryptoKey");
    expect("privateKey" in result.manifest).toBe(false);
  });
});
