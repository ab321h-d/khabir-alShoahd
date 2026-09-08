/**
 * إعداد التفعيل العام لهوية المدير. يحتوي فقط على المفتاح العام (JWK) اللازم
 * للتحقق من توقيع بيانات اعتماد التفعيل. لا يحتوي هذا الملف ولا يجوز أن
 * يحتوي أي مفتاح خاص أو سر آخر — جزء من حزمة الواجهة الأمامية، قابل للقراءة
 * الكاملة من أي مستخدم.
 *
 * مستقل تمامًا عن license/licenseConfig.ts — لا علاقة بين مفتاحَي التفعيل
 * والترخيص، ولا استيراد بينهما.
 *
 * ⚠️ PLACEHOLDER — فارغ عمدًا حتى تُوزَّع أداة إصدار تفعيل حقيقية خارج هذا
 * المستودع (Phase منفصلة مستقبلية). طالما القيمة null، أي محاولة تفعيل
 * تفشل بوضوح (fail-closed) — لا تفعيل غير مقصود ممكن قبل التزويد الفعلي.
 */
export const DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK: JsonWebKey | null = { key_ops: ["verify"], ext: true, kty: "EC", x: "S-o7tXDPY8yJwwcXQgECL3C3j06mljPjpo3RHPs152c", y: "UmWiz5hEwkFJ4Ih1NudghcvwykW5m6tcvqkX6MedVLo", crv: "P-256" };
