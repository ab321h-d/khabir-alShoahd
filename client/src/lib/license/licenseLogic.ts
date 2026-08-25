import { computeTrialExpiryIso, resolveEffectiveNow } from "./trialDate";
import { verifyLicenseCode } from "./licenseCrypto";
import type { ActivatedLicenseState, ActivationResult, AppLicenseVariant, LicenseScope, LicenseState, LicenseStatus, TrialLicenseState } from "./licenseTypes";

/**
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 */

/** هل يغطي نطاق الترخيص هذا التطبيق (معلم أو مدير)؟ */
export const scopeCoversVariant = (scope: LicenseScope, variant: AppLicenseVariant): boolean =>
  scope === "both" || scope === variant;

export const createInitialTrialState = (nowIso: string): TrialLicenseState => ({
  kind: "trial",
  trialStartedAt: nowIso,
  lastSeenAt: nowIso,
});

/**
 * يحسب حالة الترخيص الحالية (نشط/منتهٍ/نطاق غير مطابق) لتطبيق معيّن (معلم أو
 * مدير)، معتمدًا على `now` الفعلي بعد تصحيح أي تراجع مكتشف في ساعة الجهاز.
 * دالة نقية بالكامل: لا قراءة أو كتابة لأي تخزين هنا.
 */
export const computeLicenseStatus = (state: LicenseState, nowIso: string, variant: AppLicenseVariant): LicenseStatus => {
  const { effectiveNowIso, clockRollbackDetected } = resolveEffectiveNow(nowIso, state.lastSeenAt);

  if (state.kind === "trial") {
    const expiresAt = computeTrialExpiryIso(state.trialStartedAt);
    const active = new Date(effectiveNowIso).getTime() < new Date(expiresAt).getTime();
    return {
      kind: active ? "trial_active" : "trial_expired",
      effectiveNow: effectiveNowIso,
      expiresAt,
      writesAllowed: active,
      clockRollbackDetected,
    };
  }

  if (!scopeCoversVariant(state.scope, variant)) {
    return {
      kind: "wrong_scope",
      effectiveNow: effectiveNowIso,
      expiresAt: state.expiresAt,
      writesAllowed: false,
      clockRollbackDetected,
    };
  }

  const active = new Date(effectiveNowIso).getTime() < new Date(state.expiresAt).getTime();
  return {
    kind: active ? "paid_active" : "paid_expired",
    effectiveNow: effectiveNowIso,
    expiresAt: state.expiresAt,
    writesAllowed: active,
    clockRollbackDetected,
  };
};

/**
 * يقيّم كود تفعيل مقابل مفتاح عام ونطاق التطبيق الحالي، ويعيد إما حالة
 * ترخيص مفعَّلة جاهزة للحفظ، أو رسالة خطأ واضحة بالعربية. لا يكتب أي شيء
 * للتخزين بنفسه — هذه مسؤولية طبقة التخزين (licenseStore، مرحلة لاحقة).
 */
export const evaluateActivationCode = async (
  code: string,
  publicKeyJwk: JsonWebKey,
  variant: AppLicenseVariant,
  nowIso: string,
): Promise<ActivationResult> => {
  const verification = await verifyLicenseCode(code, publicKeyJwk);
  if (!verification.ok) {
    if (verification.error === "malformed") return { ok: false, error: "صيغة كود التفعيل غير صحيحة." };
    if (verification.error === "invalid_signature") return { ok: false, error: "توقيع كود التفعيل غير صالح، أو عُدِّل الكود بعد إصداره." };
    return { ok: false, error: "محتوى كود التفعيل غير مكتمل." };
  }

  const { payload } = verification;
  if (!scopeCoversVariant(payload.scope, variant)) {
    return { ok: false, error: "هذا الكود غير مخصص لهذا التطبيق (المعلم أو المدير)." };
  }

  if (new Date(payload.expiresAt).getTime() <= new Date(nowIso).getTime()) {
    return { ok: false, error: "انتهت صلاحية كود التفعيل هذا." };
  }

  const state: ActivatedLicenseState = {
    kind: "activated",
    licenseId: payload.licenseId,
    scope: payload.scope,
    activatedAt: nowIso,
    expiresAt: payload.expiresAt,
    lastSeenAt: nowIso,
  };
  return { ok: true, state };
};
