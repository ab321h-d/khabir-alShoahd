import { getCurrentLicenseStatus } from "./licenseGuard";
import type { AppLicenseVariant } from "./licenseTypes";
import { acquireWriteDenyHold, releaseWriteDenyHold } from "./writeGuardCache";

/**
 * PHASE LIC-6C.1-FIX5/FIX6: تناسق كاش الكتابة عبر تبويبات نفس الأصل.
 * FIX6: يعتمد الآن على آلية الاحتجاز الصلبة (writeGuardCache) بدل إعادة
 * ضبط الكاش يدويًا بعد كل await — يُزيل نافذة السباق العابرة جذريًا (لا
 * حاجة لتتبّع "هل لا يزال هناك جيل آخر معلَّق" لتقرير إعادة false، الاحتجاز
 * نفسه يضمن هذا تلقائيًا طالما لم يُحرَّر).
 *
 * رسائل القناة آمنة تمامًا: نوع الرسالة + معرّف جيل معتم فقط — صفر
 * signedCode/payload/accountId/entitlementId/scope/expiresAt/أي بيانات
 * حساسة إطلاقًا.
 *
 * PHASE LIC-6D-B-3B.3-B3-REAL: القناة والقفل أصبحا مُدرِكَين لـvariant —
 * عملية استرداد/تسجيل للمعلم لا تُعطِّل كتابة المدير بعد الآن (والعكس)،
 * طالما سجليهما مستقلان فعليًا (current:teacher / current:director).
 */

const channelNameForVariant = (variant: AppLicenseVariant): string => `khabir-license-state:${variant}`;

/** نفس منطق اسم قفل FIX4 السابق، الآن مُدرِك لـvariant. */
export const lockNameForVariant = (variant: AppLicenseVariant): string => `khabir-license-enrollment-current:${variant}`;

const SESSION_ID = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const createGeneration = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `gen-${Date.now()}-${Math.random().toString(16).slice(2)}`;

type SafeMessage =
  | { type: "license-state-changing"; generation: string; source: string }
  | { type: "license-state-changed"; generation: string; source: string };

const getBroadcastChannelCtor = (): typeof BroadcastChannel | undefined =>
  typeof BroadcastChannel !== "undefined" ? BroadcastChannel : undefined;

/**
 * PHASE LIC-6C.1-FIX6 §3: إشارة أفضل جهد بالكامل — صفر throw يمكن أن يفلت
 * منها إطلاقًا. فشل الإشارة (بناء/إرسال/إغلاق القناة) لا يجوز أبدًا أن
 * يُفسد تدفق الترخيص أو يمنع تنظيف finally.
 */
const broadcastSafely = (variant: AppLicenseVariant, message: SafeMessage): void => {
  try {
    const Ctor = getBroadcastChannelCtor();
    if (!Ctor) return;
    const channel = new Ctor(channelNameForVariant(variant));
    try {
      channel.postMessage(message);
    } finally {
      try {
        channel.close();
      } catch {
        // أفضل جهد — إغلاق فاشل لا يستحق كسر أي شيء
      }
    }
  } catch {
    // أفضل جهد بالكامل — إنشاء/إرسال فاشل لا يجوز أن يوقف تدفق الترخيص
  }
};

/** يُستدعى من licenseEnrollment.ts عند بدء أي تسجيل محلي لـvariant مُحدَّد — إشارة آمنة فقط، بلا بيانات ترخيص. */
export const notifyLicenseChanging = (variant: AppLicenseVariant, generation: string): void => {
  broadcastSafely(variant, { type: "license-state-changing", generation, source: SESSION_ID });
};

/** يُستدعى من licenseEnrollment.ts في finally دائمًا — حتى عند الفشل، لضمان عدم تعليق التبويبات الأخرى للأبد. */
export const notifyLicenseChanged = (variant: AppLicenseVariant, generation: string): void => {
  broadcastSafely(variant, { type: "license-state-changed", generation, source: SESSION_ID });
};

export type LicenseCrossTabSync = { dispose: () => void };

/**
 * تُهيَّأ مرة واحدة من LicenseProvider (variant معروف من هناك مباشرة).
 * تُعيد dispose() لتنظيف كامل عند إزالة المكوّن.
 */
export const initLicenseCrossTabSync = (variant: AppLicenseVariant): LicenseCrossTabSync => {
  const activeRemoteGenerations = new Set<string>();

  const handleMessage = (event: MessageEvent<SafeMessage>): void => {
    const data = event.data;
    // §7: فحص صريح لمعرّف الجلسة — لا اعتماد فقط على سلوك BroadcastChannel الافتراضي.
    if (!data || data.source === SESSION_ID) return;

    if (data.type === "license-state-changing") {
      activeRemoteGenerations.add(data.generation);
      acquireWriteDenyHold(variant, `remote:${data.generation}`);
      return;
    }
    if (data.type === "license-state-changed") {
      activeRemoteGenerations.delete(data.generation);
      releaseWriteDenyHold(variant, `remote:${data.generation}`);
      // تحديث الكاش المثبَت فقط — isWriteAllowedSync تُحسَم تلقائيًا بوجود/غياب
      // أي احتجاز آخر (محلي أو remote)، بلا أي حاجة لفحص "هل لا يزال هناك معلَّق".
      void getCurrentLicenseStatus(variant);
    }
  };

  const Ctor = getBroadcastChannelCtor();
  let channel: BroadcastChannel | null = null;
  try {
    channel = Ctor ? new Ctor(channelNameForVariant(variant)) : null;
    channel?.addEventListener("message", handleMessage as EventListener);
  } catch {
    channel = null; // أفضل جهد — تعذّر إنشاء القناة لا يمنع بقية الوحدة من العمل
  }

  /**
   * تعافٍ من إشارة "changing" مهجورة. يستخدم **نفس قفل هذا الـvariant
   * تحديدًا** — الحصول عليه يُثبِت عمليًا أن لا تسجيل آخر لنفس الـvariant
   * يحمل القفل حاليًا (FIX6 §1: بفضل أن licenseEnrollment.ts يُسجِّل طلب
   * القفل قبل البث، هذا الحاجز صحيح دائمًا — لا يمكن لاسترداد أن يسبق
   * تسجيلًا حقيقيًا معلنًا بالفعل لنفس الـvariant).
   */
  const recoverAbandoned = async (): Promise<void> => {
    if (activeRemoteGenerations.size === 0) return;
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks) {
      await locks.request(lockNameForVariant(variant), async () => {
        for (const generation of Array.from(activeRemoteGenerations)) releaseWriteDenyHold(variant, `remote:${generation}`);
        activeRemoteGenerations.clear();
      });
    } else {
      // لا Web Lock متاح — أفضل جهد ممكن بلا حاجز حقيقي؛ لا ادّعاء ضمان كامل.
      for (const generation of Array.from(activeRemoteGenerations)) releaseWriteDenyHold(variant, `remote:${generation}`);
      activeRemoteGenerations.clear();
    }
    await getCurrentLicenseStatus(variant);
  };

  const onFocus = (): void => { void recoverAbandoned(); };
  const onVisibility = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") void recoverAbandoned();
  };

  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  const dispose = (): void => {
    // PHASE LIC-6C.1-FIX6.1: تحرير الاحتجازات المتبقية أولًا، خارج أي try
    // block قد يتخطاها فشل سابق (مثلًا channel.close() فاشلة) — لا يجوز أن
    // يُسرِّب أي احتجاز عبر إعادة تركيب/إزالة LicenseProvider (React). آمن
    // ومتكرِّر الاستدعاء (idempotent): إفراغ مجموعة فارغة لا يفعل شيئًا.
    for (const generation of Array.from(activeRemoteGenerations)) releaseWriteDenyHold(variant, `remote:${generation}`);
    activeRemoteGenerations.clear();

    try {
      channel?.removeEventListener("message", handleMessage as EventListener);
      channel?.close();
    } catch {
      // أفضل جهد
    }
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };

  return { dispose };
};
