# أدوات الترخيص الخارجية (طرف البائع فقط)

هذا المجلد **ليس جزءًا من تطبيق العميل**. لا يستورده `client/` ولا يدخل ضمن
أي حزمة بناء (`vite build`). يُشغَّل يدويًا عبر Node على جهاز البائع فقط.

**PHASE B.5**: هذه الأدوات غير مربوطة بعد بأي شيء في التطبيق. الملفات في
`client/src/lib/license/licenseConfig.ts` لا تزال تحمل `LICENSE_PUBLIC_KEY_JWK = null`.

## التسلسل (عند التفعيل الفعلي لاحقًا، ليس الآن)

1. **توليد زوج مفاتيح (مرة واحدة، أو عند تدوير المفتاح):**
   ```bash
   node scripts/license-tools/generate-keypair.mjs
   ```
   ينتج `scripts/license-tools/.local-keys/private-key.local.json` و
   `public-key.local.json`. هذا المسار **مستثنى من Git**.

2. **نسخ المفتاح العام فقط** إلى التطبيق:
   افتح `public-key.local.json`، وألصق محتواه كقيمة
   `LICENSE_PUBLIC_KEY_JWK` في `client/src/lib/license/licenseConfig.ts`.

3. **توقيع كود تفعيل لعميل:**
   ```bash
   node scripts/license-tools/sign-license.mjs \
     --scope both --months 12 --license-id LIC-2027-0001 \
     --private-key scripts/license-tools/.local-keys/private-key.local.json
   ```

## قواعد أمان صارمة

- **لا يُنسخ `private-key.local.json` إلى هذا المستودع أو أي نظام تحكم
  إصدارات أو أي خدمة سحابية عامة.**
- لا يوجد أي مفتاح خاص مضمَّن مسبقًا في هذا المجلد أو في أي مكان من المشروع.
- المفتاح العام فقط هو ما يدخل إلى `client/`.
