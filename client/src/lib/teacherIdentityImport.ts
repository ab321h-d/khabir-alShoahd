/**
 * PHASE PILOT-50-F BLOCKER: تحقق من صحة identity.json + منطق قرار قبول/رفض الهوية
 * الثابتة (cross-check مع completeness.json) — صرف تمامًا، بلا فك ZIP
 * (fflate)، بلا IndexedDB. Director.tsx يفك ZIP بنفسه أصلًا؛ هذا الملف
 * مسؤول فقط عن معالجة المحتوى JSON بعد استخراجه.
 *
 * PHASE PILOT-50-F: إضافة resolveSenderTrust — التحقق التشفيري الكامل من
 * manifest.json الموقَّع الجديد + قرار الثقة (new/trusted/name_conflict).
 * identity.json القديمة (غير موقَّعة) **تبقى محفوظة بذاتها بلا حذف**
 * للتوافق الخلفي (§14) — لكنها الآن مُصنَّفة دائمًا legacy_unverified،
 * **لا تُنشئ ولا ترث ثقة تشفيرية تحت أي ظرف**.
 */
import { directorTrustRegistry } from "./directorTrustRegistry";
import { isValidSignedManifestV1Shape, sha256HexOfBytes, verifyManifestSignature, type SignedManifestV1 } from "./teacherManifestCrypto";

export type SchoolStage = "elementary" | "middle" | "secondary";

export type TeacherIdentityMetadata = {
  schemaVersion: 1;
  exportId: string;
  teacherId: string;
  /**
   * PHASE PILOT-50-F2: أصبح اختياريًا — معلم جديد (onboarding بالاسم +
   * المرحلة فقط، بلا schoolId إطلاقًا) لا يملك هذا الحقل أصلًا. **صفر
   * قيمة مُختلَقة/افتراضية أبدًا** — الغياب الحقيقي يبقى غيابًا حقيقيًا.
   * الثقة الفعلية للحزمة الجديدة تأتي من manifest.json الموقَّع
   * تشفيريًا (fingerprint/signature)، لا من هذا الحقل الوصفي القديم.
   */
  schoolId?: string;
  stage: SchoolStage;
  displayName: string;
  generatedAt: string;
};

const validStages: readonly SchoolStage[] = ["elementary", "middle", "secondary"];
const requiredFields = ["schemaVersion", "exportId", "teacherId", "stage", "displayName", "generatedAt"] as const;
const optionalFields = ["schoolId"] as const;
const allApprovedFields: readonly string[] = [...requiredFields, ...optionalFields];

/**
 * يتحقق من شكل ومحتوى identity.json المُفكَّك بالفعل من ZIP. يرفض أي حقل
 * غير المعتمَدة (6 إلزامية + schoolId اختيارية). لا trim ولا أي تحويل على
 * القيم — تحقق فقط، القيم المُعادة كما وردت حرفيًا.
 *
 * PHASE PILOT-50-F2: schoolId أصبحت اختيارية — قد تكون غائبة تمامًا (معلم
 * onboarding جديد) أو نصًّا غير فارغ (معلم مسار مدرسة legacy). **لا** يجوز
 * أن تكون قيمة فارغة/null/أي نوع آخر إن وُجدت أصلًا — فقط غياب تام أو نص صحيح.
 */
export const validateTeacherIdentityMetadata = (raw: unknown): TeacherIdentityMetadata | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const keys = Object.keys(raw as Record<string, unknown>);
  if (!requiredFields.every((field) => keys.includes(field))) return null;
  if (!keys.every((key) => allApprovedFields.includes(key))) return null; // صفر حقل غير معروف، شامل schoolId المُشوَّهة القيمة

  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== 1) return null;
  if (typeof candidate.exportId !== "string" || candidate.exportId.length === 0) return null;
  if (typeof candidate.teacherId !== "string" || candidate.teacherId.length === 0) return null;
  if ("schoolId" in candidate && (typeof candidate.schoolId !== "string" || candidate.schoolId.length === 0)) return null;
  if (typeof candidate.stage !== "string" || !validStages.includes(candidate.stage as SchoolStage)) return null;
  if (typeof candidate.displayName !== "string" || candidate.displayName.length === 0) return null;
  if (typeof candidate.generatedAt !== "string" || Number.isNaN(new Date(candidate.generatedAt).getTime())) return null;

  return candidate as unknown as TeacherIdentityMetadata;
};

/**
 * قرار fail-safe: هل تُعتمَد identity.json كهوية ثابتة فعلية للتسليم؟
 * - identity غائبة/غير صالحة أصلًا → null (legacy).
 * - completeness غائبة أو غير صالحة → null (لا مصدر cross-check موثوق داخل
 *   الحزمة نفسها؛ قرار fail-safe مقصود لهذه المرحلة، لا خطأ).
 * - exportId أو generatedAt غير متطابقين → null (الاستيراد نفسه يستمر
 *   كـlegacy، فقط بلا هوية ثابتة).
 * - تطابق كامل → تُعتمَد identity كما هي.
 */
export const resolveStableTeacherIdentity = (
  identity: TeacherIdentityMetadata | null,
  completeness: { exportId: string; generatedAt: string } | null | undefined,
): TeacherIdentityMetadata | null => {
  if (!identity) return null;
  if (!completeness) return null;
  if (identity.exportId !== completeness.exportId) return null;
  if (identity.generatedAt !== completeness.generatedAt) return null;
  return identity;
};

// =====================================================================
// PHASE PILOT-50-F — منطق manifest.json الموقَّع الجديد + قرار الثقة
// =====================================================================

export type SenderTrustResolution =
  | { status: "cryptographic_verification_failed"; reason: string }
  | { status: "stage_not_authorized"; manifest: SignedManifestV1 }
  | { status: "new_sender"; manifest: SignedManifestV1 }
  | { status: "trusted"; manifest: SignedManifestV1 }
  | { status: "name_conflict_different_sender"; manifest: SignedManifestV1; existingApprovedStage: string }
  | { status: "legacy_unverified" };

/**
 * PHASE PILOT-50-G: سياق التفويض — **إلزامي**، لا قيمة افتراضية ولا معامل
 * اختياري يسمح بـfail-open. مُستمَد حصرًا من DirectorAuthorizationRecord
 * الفعلية المُخزَّنة (عبر session.schools في Director.tsx) — صفر إمكانية
 * لأي طرف (Director.tsx نفسها، أو أي مستدعٍ مستقبلي) لتمرير "مراحل
 * مُخوَّلة" مُختلَقة كسلطة بديلة. trial: صفر قيد (تجربة منتج غير رسمية
 * أصلًا). activated: يحمل authorizedStages المُشتقَّة تشفيريًا من اعتماد
 * تفعيل المدير الموقَّع نفسه.
 */
export type SenderAuthorizationContext =
  | { kind: "trial" }
  | { kind: "activated"; authorizedStages: readonly string[] };

/**
 * التحقق الكامل fail-closed (PHASE PILOT-50-E3/§7 A-D) + قرار الثقة
 * (§9/§10/§12) + PHASE PILOT-50-G: فرض stage authorization لمدير
 * activated **قبل** أي approval/trust mutation/save — منطق domain، لا
 * فحص UI فقط. **school-level enforcement غير مُطبَّق عمدًا**: الـmanifest
 * لا يحمل schoolId موثوقًا تشفيريًا إطلاقًا (خارج نطاق G تمامًا، يتطلب
 * تغيير SignedManifestV1 schema في مرحلة منفصلة). **الاسم وحده لا يمنح
 * ثقة تحت أي ظرف** — fingerprint هو مفتاح الهوية الوحيد. يُستدعى من
 * Director.tsx بعد فك ZIP، بتمرير البايتات الخام الفعلية لكل من
 * portfolio.pdf وcompleteness.json (لا القيم المُحلَّلة/المُعاد
 * تسلسلها — PHASE PILOT-50-F/§4: "Do NOT hash parsed/re-serialized
 * completeness data").
 */
export const resolveSenderTrust = async (input: {
  manifestRaw: unknown;
  signature: string;
  pdfBytes: Uint8Array;
  completenessJsonBytes: Uint8Array;
  authorization: SenderAuthorizationContext;
}): Promise<SenderTrustResolution> => {
  if (!isValidSignedManifestV1Shape(input.manifestRaw)) {
    return { status: "cryptographic_verification_failed", reason: "malformed_manifest_shape" };
  }
  const manifest = input.manifestRaw;

  // A + B: fingerprint مُعاد حسابه + توقيع — fail-closed كامل داخل verifyManifestSignature نفسها
  const signatureResult = await verifyManifestSignature(manifest, input.signature);
  if (!signatureResult.ok) {
    return { status: "cryptographic_verification_failed", reason: signatureResult.reason };
  }

  // C + D: hash البايتات الخام الفعلية — لا القيم المُعاد تسلسلها
  const [recomputedPdfHash, recomputedCompletenessHash] = await Promise.all([
    sha256HexOfBytes(input.pdfBytes),
    sha256HexOfBytes(input.completenessJsonBytes),
  ]);
  if (recomputedPdfHash !== manifest.files["portfolio.pdf"]) {
    return { status: "cryptographic_verification_failed", reason: "portfolio_pdf_hash_mismatch" };
  }
  if (recomputedCompletenessHash !== manifest.files["completeness.json"]) {
    return { status: "cryptographic_verification_failed", reason: "completeness_json_hash_mismatch" };
  }

  // PHASE PILOT-50-G: فرض stage authorization — **قبل** أي approval/trust
  // mutation/save (getByFingerprint/touchLastSeen أدناه هي أول مسار
  // mutation محتمل، فيجب أن يسبقها هذا الفحص مباشرة). trial: صفر قيد.
  if (input.authorization.kind === "activated" && !input.authorization.authorizedStages.includes(manifest.stage)) {
    return { status: "stage_not_authorized", manifest };
  }

  // كل الفحوصات التشفيرية والتفويضية نجحت — الآن فقط قرار الثقة (منفصل تمامًا عن صحة التوقيع)
  const existingByFingerprint = await directorTrustRegistry.getByFingerprint(manifest.senderFingerprint);
  if (existingByFingerprint) {
    await directorTrustRegistry.touchLastSeen(manifest.senderFingerprint);
    return { status: "trusted", manifest };
  }

  // fingerprint غير معروف — فحص تعارض الاسم قبل الإعلان عن new_sender
  const nameConflict = await directorTrustRegistry.findApprovedByDisplayName(manifest.displayName, manifest.senderFingerprint);
  if (nameConflict) {
    return { status: "name_conflict_different_sender", manifest, existingApprovedStage: nameConflict.approvedStage };
  }

  return { status: "new_sender", manifest };
};
