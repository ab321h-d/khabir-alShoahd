/**
 * حساب تواريخ الترخيص بالأشهر التقويمية.
 *
 * القاعدة المعتمدة: عند إضافة أشهر تقويمية وعدم وجود يوم مطابق في الشهر
 * الهدف (مثال: 31 يناير + شهر = فبراير الذي لا يملك 31)، يُثبَّت التاريخ على
 * آخر يوم فعلي موجود في الشهر الهدف (Clamping)، وليس فيضانًا تلقائيًا للشهر
 * التالي كما يفعل `Date.setMonth` الافتراضي في JavaScript.
 *
 * كل الحسابات تتم بتوقيت UTC لتفادي أي فروق ناتجة عن المنطقة الزمنية المحلية
 * للجهاز عند حفظ/قراءة التواريخ كسلاسل ISO.
 *
 * PHASE B.5: ملف معزول تمامًا — لا يُستورَد من أي مكان في التطبيق الحالي.
 */

const daysInUtcMonth = (year: number, monthIndexZeroBased: number): number =>
  new Date(Date.UTC(year, monthIndexZeroBased + 1, 0)).getUTCDate();

/**
 * يضيف عدد أشهر تقويمية إلى تاريخ ISO ويعيد تاريخ ISO جديدًا، مع تثبيت اليوم
 * على آخر يوم متاح في الشهر الهدف عند الحاجة.
 */
export const addCalendarMonthsIso = (isoDate: string, months: number): string => {
  const source = new Date(isoDate);
  if (Number.isNaN(source.getTime())) throw new Error("تاريخ غير صالح لحساب الأشهر التقويمية");

  const totalMonthIndex = source.getUTCFullYear() * 12 + source.getUTCMonth() + months;
  const targetYear = Math.floor(totalMonthIndex / 12);
  const targetMonthIndex = ((totalMonthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(source.getUTCDate(), daysInUtcMonth(targetYear, targetMonthIndex));

  const result = new Date(Date.UTC(
    targetYear,
    targetMonthIndex,
    clampedDay,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  ));
  return result.toISOString();
};

/** مدة التجربة المعتمدة: 3 أشهر تقويمية بالضبط. */
export const TRIAL_DURATION_MONTHS = 3;

export const computeTrialExpiryIso = (trialStartedAtIso: string): string =>
  addCalendarMonthsIso(trialStartedAtIso, TRIAL_DURATION_MONTHS);

/** فارق بالمللي ثانية يُسمح به قبل اعتبار أي تراجع في الساعة "تلاعبًا محتملًا". */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * يمنع أن يبدو الوقت متراجعًا للخلف عند الحساب: إن كان `now` أقل من
 * `lastSeenAt` بأكثر من هامش التسامح، يُستخدم `lastSeenAt` بدلاً منه.
 * يعيد أيضًا علمًا يوضح إن رُصد تراجع فعلي.
 */
export const resolveEffectiveNow = (nowIso: string, lastSeenAtIso: string | null): { effectiveNowIso: string; clockRollbackDetected: boolean } => {
  if (!lastSeenAtIso) return { effectiveNowIso: nowIso, clockRollbackDetected: false };
  const now = new Date(nowIso).getTime();
  const lastSeen = new Date(lastSeenAtIso).getTime();
  if (Number.isNaN(now) || Number.isNaN(lastSeen)) return { effectiveNowIso: nowIso, clockRollbackDetected: false };
  if (now < lastSeen - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return { effectiveNowIso: lastSeenAtIso, clockRollbackDetected: true };
  }
  return { effectiveNowIso: nowIso, clockRollbackDetected: false };
};
