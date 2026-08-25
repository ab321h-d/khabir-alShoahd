/**
 * تعريفات بيانات نظام الترخيص. هذا الملف تعريفات فقط، بلا أي منطق تخزين أو
 * تشفير، ليبقى قابلاً للاستيراد من أي طبقة (تخزين، تحقق، واجهة) دون اعتماد
 * دائري.
 *
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 */

export type LicenseScope = "teacher" | "director" | "both";

export type AppLicenseVariant = "teacher" | "director";

/** المحتوى الموقَّع داخل كود التفعيل، كما يُصدره أداة التوقيع الخارجية. */
export type LicensePayload = {
  v: 1;
  licenseId: string;
  scope: LicenseScope;
  issuedAt: string;
  expiresAt: string;
};

/** حالة "لم يُفعَّل بعد، ضمن التجربة المجانية". */
export type TrialLicenseState = {
  kind: "trial";
  trialStartedAt: string;
  lastSeenAt: string;
};

/** حالة "تم تفعيل كود ترخيص صالح". */
export type ActivatedLicenseState = {
  kind: "activated";
  licenseId: string;
  scope: LicenseScope;
  activatedAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

export type LicenseState = TrialLicenseState | ActivatedLicenseState;

export type LicenseStatusKind =
  | "trial_active"
  | "trial_expired"
  | "paid_active"
  | "paid_expired"
  | "wrong_scope";

export type LicenseStatus = {
  kind: LicenseStatusKind;
  /** الوقت الفعلي المستخدم في الحساب بعد معالجة أي تراجع مكتشف في ساعة الجهاز. */
  effectiveNow: string;
  expiresAt: string;
  /** true عندما تكون عمليات الإنشاء/التعديل مسموحة. */
  writesAllowed: boolean;
  /** true عندما رُصد تراجع في ساعة الجهاز مقارنة بآخر وقت معروف. */
  clockRollbackDetected: boolean;
};

export type ActivationResult =
  | { ok: true; state: ActivatedLicenseState }
  | { ok: false; error: string };
