// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCanonical16ByteToken, generateCanonical32ByteToken } from "./relayUploadCapabilityCrypto";
import { getStoredUploadCapability, saveUploadCapability, confirmReplaceUploadCapability } from "./relayUploadCapabilityStore";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const DB_NAME = "khabir-teacher-relay-upload-capability-local";
const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(DB_NAME);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

describe("PHASE NEXT-2E-B2-A2-B: relayUploadCapabilityStore", () => {
  it("E) صفر سجل -> null", async () => {
    expect(await getStoredUploadCapability(generateCanonical16ByteToken())).toBeNull();
  });

  it("E) حفظ أول مرة -> saved", async () => {
    const recipientId = generateCanonical16ByteToken();
    const outcome = await saveUploadCapability({ recipientId, capabilityId: generateCanonical16ByteToken(), capabilitySecret: generateCanonical32ByteToken() });
    expect(outcome.status).toBe("saved");
  });

  it("E) idempotent: نفس recipientId+capabilityId+secret -> unchanged", async () => {
    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();
    const capabilitySecret = generateCanonical32ByteToken();
    await saveUploadCapability({ recipientId, capabilityId, capabilitySecret });
    const second = await saveUploadCapability({ recipientId, capabilityId, capabilitySecret });
    expect(second.status).toBe("unchanged");
  });

  it("E) قيم مختلفة لنفس recipientId -> replace_required، صفر كتابة تلقائية", async () => {
    const recipientId = generateCanonical16ByteToken();
    await saveUploadCapability({ recipientId, capabilityId: generateCanonical16ByteToken(), capabilitySecret: generateCanonical32ByteToken() });
    const second = await saveUploadCapability({ recipientId, capabilityId: generateCanonical16ByteToken(), capabilitySecret: generateCanonical32ByteToken() });
    expect(second.status).toBe("replace_required");

    const stored = await getStoredUploadCapability(recipientId);
    expect(stored?.capabilityId).not.toBeUndefined();
  });

  it("تأكيد استبدال صريح ناجح TOCTOU-safe", async () => {
    const recipientId = generateCanonical16ByteToken();
    const oldCapabilityId = generateCanonical16ByteToken();
    await saveUploadCapability({ recipientId, capabilityId: oldCapabilityId, capabilitySecret: generateCanonical32ByteToken() });

    const newCapabilityId = generateCanonical16ByteToken();
    const newSecret = generateCanonical32ByteToken();
    const result = await confirmReplaceUploadCapability(recipientId, oldCapabilityId, { capabilityId: newCapabilityId, capabilitySecret: newSecret });
    expect(result.ok).toBe(true);

    const stored = await getStoredUploadCapability(recipientId);
    expect(stored?.capabilityId).toBe(newCapabilityId);
  });

  it("تأكيد استبدال بـcapabilityId قديم غير مطابق (stale) يفشل بأمان، صفر تغيير", async () => {
    const recipientId = generateCanonical16ByteToken();
    const actualOldId = generateCanonical16ByteToken();
    await saveUploadCapability({ recipientId, capabilityId: actualOldId, capabilitySecret: generateCanonical32ByteToken() });

    const result = await confirmReplaceUploadCapability(recipientId, "wrong-old-id-not-matching-format", { capabilityId: generateCanonical16ByteToken(), capabilitySecret: generateCanonical32ByteToken() });
    expect(result.ok).toBe(false);

    const stored = await getStoredUploadCapability(recipientId);
    expect(stored?.capabilityId).toBe(actualOldId);
  });

  it("سجل مُخزَّن مُشوَّه يُعامَل كغائب (fail-closed) عند القراءة", async () => {
    const recipientId = generateCanonical16ByteToken();
    await new Promise<void>((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("uploadCapabilities")) db.createObjectStore("uploadCapabilities", { keyPath: "recipientId" });
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("uploadCapabilities", "readwrite");
        tx.objectStore("uploadCapabilities").put({ recipientId, capabilityId: "corrupted", capabilitySecret: "also-corrupted", storedAt: "invalid-date" });
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    expect(await getStoredUploadCapability(recipientId)).toBeNull();
  });

  it("payload غير قانوني الصيغة يُرفَض قبل أي كتابة", async () => {
    await expect(saveUploadCapability({ recipientId: "x", capabilityId: generateCanonical16ByteToken(), capabilitySecret: generateCanonical32ByteToken() })).rejects.toThrow();
  });
});
