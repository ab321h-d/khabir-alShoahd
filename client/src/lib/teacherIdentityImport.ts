/**
 * PHASE ID-3D.2: تحقق من صحة identity.json + منطق قرار قبول/رفض الهوية
 * الثابتة (cross-check مع completeness.json) — صرف تمامًا، بلا فك ZIP
 * (fflate)، بلا IndexedDB. Director.tsx يفك ZIP بنفسه أصلًا؛ هذا الملف
 * مسؤول فقط عن معالجة المحتوى JSON بعد استخراجه.
 *
 * تنبيه ثقة صريح: identity.json بيانات وصفية غير موقَّعة (unsigned
 * metadata). حتى نجاح التطابق مع completeness.json هو فحص اتساق (consistency
 * check) فقط، لا إثباتًا تشفيريًا ولا مقاومة لتلاعب يدوي بملف ZIP خارج
 * التطبيق.
 */

export type SchoolStage = "elementary" | "middle" | "secondary";

export type TeacherIdentityMetadata = {
  schemaVersion: 1;
  exportId: string;
  teacherId: string;
  schoolId: string;
  stage: SchoolStage;
  displayName: string;
  generatedAt: string;
};

const validStages: readonly SchoolStage[] = ["elementary", "middle", "secondary"];
const approvedFields = ["schemaVersion", "exportId", "teacherId", "schoolId", "stage", "displayName", "generatedAt"] as const;

/**
 * يتحقق من شكل ومحتوى identity.json المُفكَّك بالفعل من ZIP. يرفض أي حقل
 * إضافي غير السبعة المعتمَدة. لا trim ولا أي تحويل على القيم — تحقق فقط،
 * القيم المُعادة كما وردت حرفيًا.
 */
export const validateTeacherIdentityMetadata = (raw: unknown): TeacherIdentityMetadata | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const keys = Object.keys(raw as Record<string, unknown>);
  if (keys.length !== approvedFields.length) return null;
  if (!approvedFields.every((field) => keys.includes(field))) return null;

  const candidate = raw as Record<string, unknown>;

  if (candidate.schemaVersion !== 1) return null;
  if (typeof candidate.exportId !== "string" || candidate.exportId.length === 0) return null;
  if (typeof candidate.teacherId !== "string" || candidate.teacherId.length === 0) return null;
  if (typeof candidate.schoolId !== "string" || candidate.schoolId.length === 0) return null;
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
