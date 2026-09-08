# أدوات إصدار تفعيل المدير (إدارية محلية فقط)

**لا تُشغَّل هذه الأدوات كجزء من build العميل. لا يُستورَد أي منها من أي كود تحت `client/`.**

## الاستخدام

1. توليد زوج مفاتيح (مرة واحدة فقط لكل بيئة إصدار):
```bash
node tools/director-activation/generate-keypair.mjs
```
يُنشئ `tools/director-activation/.local-keys/private-key.local.json` (محلي، مُستثنًى من Git) و`public-key.local.json`، ويطبع المفتاح العام (JWK) على الشاشة.

2. انسخ المفتاح العام يدويًا إلى:
```
client/src/lib/directorActivationConfig.ts → DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK
```

3. إصدار بيانات اعتماد تفعيل لمدرسة/مرحلة:
```bash
node tools/director-activation/issue-credential.mjs --schoolId 1001 --stage elementary --expiresInDays 90
```

## أمان

- `tools/director-activation/.local-keys/` **مُستثناة بالكامل في `.gitignore`** — لا تُرفَع أبدًا.
- **لا تنقل `private-key.local.json` إلى أي مكان تحت `client/` أو `dist/` أو أي نظام تحكم إصدارات.**
- المفتاح العام فقط هو ما يُضمَّن في حزمة العميل.
