/**
 * إعداد التفعيل العام لهوية المعلم. يحتوي فقط على المفتاح العام (JWK) اللازم
 * للتحقق من توقيع بيانات اعتماد تفعيل المعلم. لا يحتوي هذا الملف ولا يجوز أن
 * يحتوي أي مفتاح خاص أو سر آخر — جزء من حزمة الواجهة الأمامية، قابل للقراءة
 * الكاملة من أي مستخدم.
 *
 * مستقل تمامًا عن directorActivationConfig.ts — مفتاح منفصل بالكامل لا
 * يُشارَك مع تفعيل المدير، ولا استيراد بينهما.
 *
 * ⚠️ PLACEHOLDER — فارغ عمدًا حتى تُوزَّع أداة إصدار تفعيل معلم حقيقية خارج
 * هذا المستودع (Phase منفصلة مستقبلية، خارج نطاق ID-3A). طالما القيمة null،
 * أي محاولة تفعيل تفشل بوضوح (fail-closed).
 */
export const TEACHER_ACTIVATION_PUBLIC_KEY_JWK: JsonWebKey | null = {
  "key_ops": ["verify"],
  "ext": true,
  "kty": "EC",
  "x": "2u25zNplS6gWp2hGr03zFTMvIIjnxWmyf5-40R3ZISc",
  "y": "BLLymhREkBifrG1Ykt6ZbqQLHUSp12Ws7HnukCTqfZc",
  "crv": "P-256"
};
