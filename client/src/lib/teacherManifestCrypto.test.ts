import { describe, expect, it } from "vitest";

const {
  buildCanonicalManifestBytes,
  buildCanonicalPublicKeyString,
  computeSenderFingerprint,
  signCanonicalManifest,
  verifyManifestSignature,
  isValidSignedManifestV1Shape,
  sha256HexOfBytes,
} = await import("./teacherManifestCrypto");

const generateTestKeyPair = () => crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);

const buildBaseManifest = async (publicKeyJwk: JsonWebKey) => {
  const fingerprint = await computeSenderFingerprint(publicKeyJwk);
  return {
    schemaVersion: 1 as const, exportId: "export-001", generatedAt: "2026-09-18T00:00:00.000Z",
    senderFingerprint: fingerprint, senderPublicKeyJwk: publicKeyJwk, displayName: "أ. نورة", stage: "middle",
    files: { "portfolio.pdf": "aaaa1111", "completeness.json": "bbbb2222" },
  };
};

describe("PILOT-50-F CANONICALIZATION", () => {
  it("Teacher/Director يبنيان بايتات حتمية متطابقة تمامًا من نفس المُدخَل", async () => {
    const keyPair = await generateTestKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const manifest = await buildBaseManifest(publicKeyJwk);
    const bytesA = buildCanonicalManifestBytes(manifest);
    const bytesB = buildCanonicalManifestBytes(JSON.parse(JSON.stringify(manifest)));
    expect(Buffer.from(bytesA).equals(Buffer.from(bytesB))).toBe(true);
  });

  it("x/y الحقيقيَّان موجودان فعليًا في البايتات (لا {})", async () => {
    const keyPair = await generateTestKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const manifest = await buildBaseManifest(publicKeyJwk);
    const decoded = new TextDecoder().decode(buildCanonicalManifestBytes(manifest));
    expect(decoded).toContain(publicKeyJwk.x as string);
    expect(decoded).toContain(publicKeyJwk.y as string);
  });

  it("PDF hash موجود فعليًا في البايتات", async () => {
    const keyPair = await generateTestKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const manifest = await buildBaseManifest(publicKeyJwk);
    expect(new TextDecoder().decode(buildCanonicalManifestBytes(manifest))).toContain("aaaa1111");
  });

  it("completeness hash موجود فعليًا في البايتات", async () => {
    const keyPair = await generateTestKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const manifest = await buildBaseManifest(publicKeyJwk);
    expect(new TextDecoder().decode(buildCanonicalManifestBytes(manifest))).toContain("bbbb2222");
  });

  it("buildCanonicalPublicKeyString صيغة ثابتة EC:P-256:x:y", () => {
    expect(buildCanonicalPublicKeyString({ x: "XX", y: "YY" })).toBe("EC:P-256:XX:YY");
  });
});

describe("PILOT-50-F SIGNATURE/TAMPER (test vectors)", () => {
  const setup = async () => {
    const keyPair = await generateTestKeyPair();
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const manifest = await buildBaseManifest(publicKeyJwk);
    const signature = await signCanonicalManifest(manifest, keyPair.privateKey);
    return { manifest, signature, publicKeyJwk };
  };

  it("baseline صالح -> ok:true", async () => {
    const { manifest, signature } = await setup();
    expect((await verifyManifestSignature(manifest, signature)).ok).toBe(true);
  });

  it("تعديل بايت PDF hash -> فشل", async () => {
    const { manifest, signature } = await setup();
    const result = await verifyManifestSignature({ ...manifest, files: { ...manifest.files, "portfolio.pdf": "aaaa1112" } }, signature);
    expect(result.ok).toBe(false);
  });

  it("تعديل completeness hash -> فشل", async () => {
    const { manifest, signature } = await setup();
    const result = await verifyManifestSignature({ ...manifest, files: { ...manifest.files, "completeness.json": "bbbb2223" } }, signature);
    expect(result.ok).toBe(false);
  });

  it("تعديل displayName -> فشل", async () => {
    const { manifest, signature } = await setup();
    expect((await verifyManifestSignature({ ...manifest, displayName: "أ. سارة" }, signature)).ok).toBe(false);
  });

  it("تعديل stage -> فشل", async () => {
    const { manifest, signature } = await setup();
    expect((await verifyManifestSignature({ ...manifest, stage: "secondary" }, signature)).ok).toBe(false);
  });

  it("تعديل إحداثية x -> فشل مغلق (fail closed، سواء لأن المفتاح أصبح غير صالح بنيويًا أو لأن fingerprint لم يعد يطابق)", async () => {
    const { manifest, signature, publicKeyJwk } = await setup();
    const result = await verifyManifestSignature({ ...manifest, senderPublicKeyJwk: { ...publicKeyJwk, x: (publicKeyJwk.x as string).slice(0, -2) + "00" } }, signature);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["malformed", "fingerprint_mismatch"]).toContain(result.reason);
  });

  it("تعديل senderFingerprint -> فشل", async () => {
    const { manifest, signature } = await setup();
    const result = await verifyManifestSignature({ ...manifest, senderFingerprint: "forged" }, signature);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("fingerprint_mismatch");
  });

  it("تعديل exportId -> فشل", async () => {
    const { manifest, signature } = await setup();
    expect((await verifyManifestSignature({ ...manifest, exportId: "export-002" }, signature)).ok).toBe(false);
  });

  it("تعديل generatedAt -> فشل", async () => {
    const { manifest, signature } = await setup();
    expect((await verifyManifestSignature({ ...manifest, generatedAt: "2026-09-19T00:00:00.000Z" }, signature)).ok).toBe(false);
  });

  it("JWK مُشوَّه بنيويًا -> فشل مغلق", async () => {
    const { manifest, signature } = await setup();
    const result = await verifyManifestSignature({ ...manifest, senderPublicKeyJwk: { kty: "EC", crv: "P-256", x: "not-valid-base64!!", y: "also-not-valid!!" } }, signature);
    expect(result.ok).toBe(false);
  });

  it("توقيع مُشوَّه الصيغة -> فشل مغلق", async () => {
    const { manifest } = await setup();
    const result = await verifyManifestSignature(manifest, "not-a-valid-base64url-signature!!!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("schema غير مدعوم (isValidSignedManifestV1Shape) -> فشل مغلق", () => {
    expect(isValidSignedManifestV1Shape({ schemaVersion: 2 })).toBe(false);
    expect(isValidSignedManifestV1Shape(null)).toBe(false);
    expect(isValidSignedManifestV1Shape("garbage")).toBe(false);
    expect(isValidSignedManifestV1Shape({ schemaVersion: 1, senderPublicKeyJwk: { kty: "RSA" } })).toBe(false);
  });

  it("sha256HexOfBytes حتمية", async () => {
    const bytes = new TextEncoder().encode("test-content");
    const h1 = await sha256HexOfBytes(bytes);
    const h2 = await sha256HexOfBytes(bytes);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
