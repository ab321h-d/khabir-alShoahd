// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const { buildSignedManifestForExport } = await import("./teacherSenderIdentity");
const { resolveSenderTrust, validateTeacherIdentityMetadata } = await import("./teacherIdentityImport");

const resetDatabase = (name: string) => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
const resetAll = () => Promise.all([
  resetDatabase("khabir-teacher-sender-identity-local"),
  resetDatabase("khabir-director-trust-registry-local"),
]);

beforeEach(async () => { await resetAll(); });
afterEach(async () => { await resetAll(); });

describe("PILOT-50-F2: معلم onboarding جديد بلا schoolId يستطيع التصدير والتحقق الكامل", () => {
  it("A) معلم اسم+مرحلة فقط (بلا schoolId) يبني manifest/signature صالحَين فعليًا", async () => {
    const pdfBytes = new TextEncoder().encode("real-pdf-content");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-noschool-1" }));

    const { manifest, signature } = await buildSignedManifestForExport({
      exportId: "exp-noschool-1",
      generatedAt: new Date().toISOString(),
      displayName: "معلم onboarding جديد",
      stage: "middle",
      pdfBytes,
      completenessJsonBytes,
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);
    // SignedManifestV1 لا تحتوي schoolId في تعريفها أصلًا — يُثبِت بنيويًا صفر اعتماد عليه هنا
    expect("schoolId" in manifest).toBe(false);
  });

  it("B) الحزمة الناتجة تحتوي manifest/signature/file hashes صالحة تمامًا (يمكن التحقق منها ذاتيًا)", async () => {
    const pdfBytes = new TextEncoder().encode("real-pdf-content-b");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-noschool-2" }));
    const { manifest } = await buildSignedManifestForExport({
      exportId: "exp-noschool-2", generatedAt: new Date().toISOString(), displayName: "معلم", stage: "elementary",
      pdfBytes, completenessJsonBytes,
    });
    expect(manifest.files["portfolio.pdf"]).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.files["completeness.json"]).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.senderFingerprint.length).toBeGreaterThan(0);
  });

  it("C) المدير يتحقق ويقبل حزمة موقَّعة صادرة من معلم بلا schoolId (new_sender)", async () => {
    const pdfBytes = new TextEncoder().encode("real-pdf-content-c");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-noschool-3" }));
    const { manifest, signature } = await buildSignedManifestForExport({
      exportId: "exp-noschool-3", generatedAt: new Date().toISOString(), displayName: "معلم بلا مدرسة", stage: "secondary",
      pdfBytes, completenessJsonBytes,
    });

    const result = await resolveSenderTrust({ manifestRaw: manifest, signature, pdfBytes, completenessJsonBytes });
    expect(result.status).toBe("new_sender"); // قبول تشفيري كامل، بصرف النظر التام عن غياب schoolId
  });

  it("D) توقيع مفقود/غير صالح يبقى fail-closed حتى من معلم بلا schoolId (صفر تساهل)", async () => {
    const pdfBytes = new TextEncoder().encode("real-pdf-content-d");
    const completenessJsonBytes = new TextEncoder().encode(JSON.stringify({ exportId: "exp-noschool-4" }));
    const { manifest } = await buildSignedManifestForExport({
      exportId: "exp-noschool-4", generatedAt: new Date().toISOString(), displayName: "معلم", stage: "middle",
      pdfBytes, completenessJsonBytes,
    });

    const withInvalidSignature = await resolveSenderTrust({ manifestRaw: manifest, signature: "not-a-valid-signature", pdfBytes, completenessJsonBytes });
    expect(withInvalidSignature.status).toBe("cryptographic_verification_failed");

    const withMissingSignature = await resolveSenderTrust({ manifestRaw: manifest, signature: "", pdfBytes, completenessJsonBytes });
    expect(withMissingSignature.status).toBe("cryptographic_verification_failed");
  });

  it("E) صفر schoolId مُختلَق/افتراضي في identity.json المُنشَأة لمعلم onboarding جديد", () => {
    // محاكاة identity.json كما تُبنى فعليًا في Home.tsx لمعلم onboarding (بلا "schoolId" in identity)
    const identityWithoutSchool = { schemaVersion: 1, exportId: "exp-5", teacherId: "t-5", stage: "middle", displayName: "معلم", generatedAt: new Date().toISOString() };
    expect("schoolId" in identityWithoutSchool).toBe(false); // صفر حقل مُدرَج إطلاقًا، لا حتى undefined صريحة أو قيمة فارغة

    const validated = validateTeacherIdentityMetadata(identityWithoutSchool);
    expect(validated).not.toBeNull();
    expect(validated && "schoolId" in validated).toBe(false); // التحقق نفسه لا يُضيف/يُخلِق أي قيمة
  });

  it("E-ب) schoolId فارغة نصيًا (لو أُدرِجت خطأً) تُرفَض صراحة — لا تُقبَل كـ\"مدرسة صالحة\" مُختلَقة", () => {
    const withEmptySchoolId = { schemaVersion: 1, exportId: "exp-6", teacherId: "t-6", schoolId: "", stage: "middle", displayName: "معلم", generatedAt: new Date().toISOString() };
    expect(validateTeacherIdentityMetadata(withEmptySchoolId)).toBeNull();
  });

  it("F) مسار legacy (schoolId حقيقي غير فارغ) لا يزال يعمل بلا أي تغيير", () => {
    const legacyIdentity = { schemaVersion: 1, exportId: "exp-7", teacherId: "t-7", schoolId: "2002", stage: "middle", displayName: "معلم مدرسة", generatedAt: new Date().toISOString() };
    const validated = validateTeacherIdentityMetadata(legacyIdentity);
    expect(validated).not.toBeNull();
    expect(validated?.schoolId).toBe("2002");
  });
});
