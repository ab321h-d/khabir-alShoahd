/**
 * PHASE PILOT-50-D — نمط التوزيع المركزي الوحيد. يُقرَأ حصرًا من متغيّر
 * بيئة وقت البناء (VITE_DISTRIBUTION_MODE) — Vite يُضمِّنه كثابت داخل
 * الحزمة النهائية وقت `vite build`، لا يمكن تغييره بعد ذلك من runtime
 * (لا localStorage، لا query string، لا أي تفاعل UI) — هذا القرار أمني
 * لا واجهي عمدًا: تغيير النمط يتطلب إعادة بناء كاملة.
 *
 * القيم المقبولة فقط: "controlled-pilot" | "public-trial".
 *
 * Fail-closed: أي قيمة غير معروفة أو غائبة تُعامَل كـ"controlled-pilot"
 * (النمط الأكثر تقييدًا — صفر بدء تجربة تلقائي) — لا الأكثر تساهلًا. هذا
 * يمنع أي خطأ تكوين صامت (نسيان ضبط المتغيّر مثلًا) من منح تجربة مجانية
 * تلقائية لأي مستخدم بالخطأ.
 */

export type DistributionMode = "controlled-pilot" | "public-trial";

const rawValue: unknown = import.meta.env.VITE_DISTRIBUTION_MODE;

export const DISTRIBUTION_MODE: DistributionMode = rawValue === "public-trial" ? "public-trial" : "controlled-pilot";
