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

/**
 * PHASE LIC-6A: نموذج entitlement موقَّع موحَّد (تجربة أو مدفوع)، مستقل
 * تمامًا عن LicensePayload v:1 القديم — إصدار v:2 صريح لمنع أي التباس بين
 * المُدقِّقين. accountId/kind/scope/expiresAt جميعها مشمولة بالتوقيع.
 */
export type EntitlementKind = "trial" | "paid";

export type SignedEntitlementPayload = {
  v: 2;
  entitlementId: string;
  accountId: string;
  kind: EntitlementKind;
  scope: LicenseScope;
  issuedAt: string;
  expiresAt: string;
};

/**
 * الحالة المُخزَّنة مستقبلًا (LIC-6B، غير مُنفَّذة هنا) — تُخزِّن الغلاف
 * الموقَّع الخام نفسه، لا أي حقل payload مُستخرَج مسبقًا. أي حقل payload
 * "موثوق" يُشتَق فقط بعد إعادة تحقق تشفيري ناجح في كل قراءة — تعديل مباشر
 * لـ`signedCode` في IndexedDB يُبطِل التوقيع فورًا عند إعادة التحقق.
 */
export type SignedEntitlementState = {
  kind: "entitlement";
  signedCode: string;
  lastSeenAt: string;
};

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
