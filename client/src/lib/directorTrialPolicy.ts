/**
 * PHASE PILOT-50-F3.4 — سياسة مدة تجربة المدير. معزولة تمامًا عن
 * trialDate.ts (TRIAL_DURATION_MONTHS الخاصة بالمعلم) — صفر استيراد
 * متبادل بين الملفين، صفر قيمة مُشترَكة. تجربة المدير مفهوم منتجي منفصل
 * تمامًا، مدته الافتراضية هنا قرار صريح مُوثَّق، لا استعارة ضمنية.
 *
 * القيمة الافتراضية المختارة: 14 يومًا — كافية لتجربة منتج حقيقية (لوحة،
 * استيراد حزم موقَّعة، مراجعة، تقارير) بلا التباس مع مفهوم "تجربة مجانية
 * 3 أشهر" الخاص بالمعلم تحديدًا. قابلة للتعديل هنا فقط — نقطة تكوين
 * واحدة، صفر انتشار لقيمة سحرية عبر قاعدة الكود.
 */

export const DIRECTOR_TRIAL_DURATION_DAYS = 14;

export const computeDirectorTrialExpiryIso = (startedAtIso: string): string =>
  new Date(new Date(startedAtIso).getTime() + DIRECTOR_TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

export const isDirectorTrialExpired = (startedAtIso: string, nowIso: string = new Date().toISOString()): boolean =>
  new Date(nowIso).getTime() >= new Date(computeDirectorTrialExpiryIso(startedAtIso)).getTime();
