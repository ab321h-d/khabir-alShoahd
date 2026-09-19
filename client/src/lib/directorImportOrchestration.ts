/**
 * PHASE PILOT-50-F3.1 + F3.2 — دالة تنسيق صغيرة مُستخرَجة عمدًا من
 * Director.tsx لجعل منطق "منع الحفظ فعليًا عند إعادة الإرسال" قابلًا
 * للاختبار بمعزل عن تعقيد React/DOM. **صفر منطق تشفيري هنا** — فقط
 * تنسيق الترتيب الصحيح بين فحص/تسجيل exportId واستدعاء الحفظ الفعلي.
 *
 * PHASE PILOT-50-F3.2 — تصحيح جوهري: مصدر الحقيقة لمنع التكرار الآن هو
 * **directorStore نفسها** (findExistingSubmissionByExportId، نفس القاعدة
 * التي كتبت السجل فعليًا) لا سجل ثقة منفصل بقاعدة IndexedDB أخرى. هذا
 * يحل مشكلة عدم وجود atomicity عبر قاعدتين منفصلتين (directorStore
 * وdirectorTrustRegistry حقًا قاعدتان مختلفتان تمامًا — صفر ادّعاء
 * اتساق معاملاتي بينهما): لو نجح save() لكن فشل markExportIdSeen()
 * لاحقًا (قاعدة أخرى)، السجل يبقى موجودًا فعليًا في directorStore نفسها،
 * فمحاولة إعادة الإرسال اللاحقة تجده مباشرة عبر
 * findExistingSubmissionByExportId — صفر اعتماد على نجاح الكتابة الثانية
 * المنفصلة. markExportIdSeen تبقى best-effort بعد النجاح (طبقة معلوماتية
 * إضافية في سجل الثقة، فشلها لا يُبطِل نجاح الاستيراد ولا يخلق تكرارًا).
 */

export type DirectorImportPersistenceOutcome<TSubmission> =
  | { status: "rejected_replay" }
  | { status: "saved"; submission: TSubmission }
  | { status: "save_failed"; error: unknown };

/**
 * exportId قد يكون null (حزمة legacy غير موقَّعة، أو حزمة موقَّعة فشل
 * تحققها التشفيري بالفعل قبل الوصول لهذه الدالة) — في هذه الحالة صفر
 * فحص/تسجيل replay إطلاقًا، الحفظ يستمر مباشرة كما كان دائمًا لهذه الحزم.
 *
 * الترتيب الإلزامي:
 *   1. استعلام directorStore نفسها (findExistingSubmissionByExportId) —
 *      المصدر الموثوق الوحيد. وجود سجل فعلي -> "rejected_replay" فورًا،
 *      صفر استدعاء لـsave() إطلاقًا.
 *   2. خلاف ذلك: استدعاء save() فعليًا.
 *   3. نجاح save(): محاولة best-effort لتسجيل exportId في سجل الثقة
 *      (طبقة إضافية، لا حرجة) — فشلها لا يُغيِّر نتيجة "saved" النهائية.
 *   4. فشل save(): exportId لم يُلمَس في أي قاعدة، إعادة المحاولة ممكنة.
 */
export const performTrustedImportSave = async <TSubmission>(input: {
  exportId: string | null;
  findExistingSubmissionByExportId: (exportId: string) => Promise<unknown | null>;
  markExportIdSeen: (exportId: string) => Promise<void>;
  save: () => Promise<TSubmission>;
}): Promise<DirectorImportPersistenceOutcome<TSubmission>> => {
  if (input.exportId) {
    const existing = await input.findExistingSubmissionByExportId(input.exportId);
    if (existing) {
      return { status: "rejected_replay" };
    }
  }

  let submission: TSubmission;
  try {
    submission = await input.save();
  } catch (error) {
    return { status: "save_failed", error };
  }

  if (input.exportId) {
    // best-effort — فشل هذه الخطوة لا يُبطِل نجاح الحفظ (الذي حدث بالفعل
    // ومُلتزَم في directorStore)، ولا يخلق تكرارًا لاحقًا لأن الفحص القادم
    // (§1 أعلاه) يستعلم directorStore نفسها، لا هذا السجل.
    try {
      await input.markExportIdSeen(input.exportId);
    } catch {
      // صفر معالجة إضافية — الطبقة المعلوماتية فشلت، السجل الحقيقي سليم.
    }
  }

  return { status: "saved", submission };
};
