/**
 * إعداد الترخيص العام لهذا التطبيق. يحتوي فقط على المفتاح العام (JWK) اللازم
 * للتحقق من توقيع أكواد التفعيل. لا يحتوي هذا الملف ولا يجوز أن يحتوي أي
 * مفتاح خاص أو سر آخر — هذا الملف جزء من حزمة الواجهة الأمامية (frontend)،
 * وقابل للقراءة الكاملة من أي مستخدم.
 *
 * Release-1: تم استبدال القيمة بالمفتاح العام الإنتاجي الفعلي (ECDSA P-256)،
 * المولَّد عبر `scripts/license-tools/generate-keypair.mjs` على جهاز خارج
 * هذا المستودع. المفتاح الخاص المطابق له لم يُنسخ ولم يُلمَس هنا إطلاقًا.
 */
export const LICENSE_PUBLIC_KEY_JWK: JsonWebKey | null = {
  key_ops: ["verify"],
  ext: true,
  kty: "EC",
  x: "rxTg_xBUD94PWHbPfQI9PYlss-ln60TB-fp8gsDPuiM",
  y: "yDrwhUuW8elcAGhlpBQVgCOFvMLHPrTrjqElFn5ScN4",
  crv: "P-256",
};

export const LICENSE_CONFIG_NOTES = {
  algorithm: "ECDSA P-256 / SHA-256",
  keyToolPath: "scripts/license-tools/",
  warning: "استبدل LICENSE_PUBLIC_KEY_JWK بالمفتاح العام الفعلي قبل الإصدار الإنتاجي.",
} as const;
