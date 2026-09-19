// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { resolveSenderTrust } = await import("./teacherIdentityImport");
const { directorTrustRegistry } = await import("./directorTrustRegistry");
const { signCanonicalManifest, computeSenderFingerprint } = await import("./teacherManifestCrypto");

const resetDatabase = () => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase("khabir-director-trust-registry-local");
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDatabase(); });
afterEach(async () => { await resetDatabase(); });

const pdfBytes = new TextEncoder().encode("pdf-content-real");
const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-1" }));

const buildValidPackage = async (stage: string, displayName = "معلم", exportId = "exp-1") => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const fingerprint = await computeSenderFingerprint(publicKeyJwk);
  const sha256Hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const manifest = {
    schemaVersion: 1 as const, exportId, generatedAt: new Date().toISOString(),
    senderFingerprint: fingerprint, senderPublicKeyJwk: publicKeyJwk, displayName, stage,
    files: { "portfolio.pdf": await sha256Hex(pdfBytes), "completeness.json": await sha256Hex(completenessJsonBytes) },
  };
  const signature = await signCanonicalManifest(manifest, keyPair.privateKey);
  return { manifest, signature };
};

describe("PILOT-50-G: stage authorization enforcement", () => {
  it("A) activated بمرحلة middle فقط + manifest.stage=middle -> new_sender (السلوك الحالي، بلا تغيير)", async () => {
    const { manifest, signature } = await buildValidPackage("middle");
    const result = await resolveSenderTrust({
      manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["middle"] },
    });
    expect(result.status).toBe("new_sender");
  });

  it("B) activated بمرحلة middle فقط + manifest.stage=secondary -> stage_not_authorized", async () => {
    const { manifest, signature } = await buildValidPackage("secondary");
    const result = await resolveSenderTrust({
      manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["middle"] },
    });
    expect(result.status).toBe("stage_not_authorized");
    if (result.status === "stage_not_authorized") expect(result.manifest.stage).toBe("secondary");
  });

  it("C) activated بمدارس متعددة (elementary+middle) + manifest.stage=elementary -> new_sender", async () => {
    const { manifest, signature } = await buildValidPackage("elementary");
    const result = await resolveSenderTrust({
      manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["elementary", "middle"] },
    });
    expect(result.status).toBe("new_sender");
  });

  it("D) activated بمدارس متعددة (elementary+middle) + manifest.stage=secondary -> stage_not_authorized", async () => {
    const { manifest, signature } = await buildValidPackage("secondary");
    const result = await resolveSenderTrust({
      manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["elementary", "middle"] },
    });
    expect(result.status).toBe("stage_not_authorized");
  });

  it("E) trial + أي stage مدعومة -> السلوك الحالي بلا تغيير (صفر قيد)", async () => {
    for (const stage of ["elementary", "middle", "secondary"]) {
      await resetDatabase();
      const { manifest, signature } = await buildValidPackage(stage, "معلم", `exp-trial-${stage}`);
      const result = await resolveSenderTrust({
        manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes,
        authorization: { kind: "trial" },
      });
      expect(result.status).toBe("new_sender");
    }
  });

  it("F) stage غير مُخوَّلة -> صفر approval/trust mutation (getByFingerprint تبقى null بعد الرفض)", async () => {
    const { manifest, signature } = await buildValidPackage("secondary");
    const result = await resolveSenderTrust({
      manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["middle"] },
    });
    expect(result.status).toBe("stage_not_authorized");
    // صفر أي أثر في سجل الثقة — لا اعتماد، لا touchLastSeen، لا سجل جديد بأي شكل
    const trustRecord = await directorTrustRegistry.getByFingerprint(manifest.senderFingerprint);
    expect(trustRecord).toBeNull();
  });

  it("G) manifest مُشوَّه/بلا stage صالحة -> يبقى fail-closed عبر التحقق الحالي (isValidSignedManifestV1Shape)، صفر تغيير", async () => {
    const { manifest, signature } = await buildValidPackage("middle");
    const malformed = { ...manifest, stage: undefined };
    const result = await resolveSenderTrust({
      manifestRaw: malformed, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["middle"] },
    });
    expect(result.status).toBe("cryptographic_verification_failed"); // فحص الشكل يرفض أولًا، قبل الوصول لفحص stage authorization إطلاقًا
  });

  it("H) سلوك التوقيع/hash/fingerprint التشفيري يبقى بلا تغيير (تلاعب بحقل غير stage يبقى مرفوضًا تشفيريًا كما كان)", async () => {
    const { manifest, signature } = await buildValidPackage("middle");
    const tampered = { ...manifest, displayName: "منتحل" }; // تعديل بعد التوقيع
    const result = await resolveSenderTrust({
      manifestRaw: tampered, signature, pdfBytes, completenessJsonBytes,
      authorization: { kind: "activated", authorizedStages: ["middle"] },
    });
    expect(result.status).toBe("cryptographic_verification_failed"); // فشل توقيع قبل الوصول لفحص stage، كما هو مطلوب
  });
});
