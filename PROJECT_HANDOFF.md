# تسليم المشروع — خبير الشواهد

## تشغيل المشروع

يتطلب المشروع Node.js وpnpm. بعد تثبيت الاعتمادات عبر `pnpm install --frozen-lockfile`، شغّل `pnpm dev` للتطبيق الموحّد، أو `pnpm dev:teacher` و`pnpm dev:director` لتجربة كل تطبيق على حدة.

| الناتج | أمر البناء | مجلد الناتج |
|---|---|---|
| إنتاج موحّد مع خادم ثابت | `pnpm build` | `dist/public` و`dist/index.js` |
| المعلم فقط | `pnpm build:teacher` | `dist/teacher` |
| المدير فقط | `pnpm build:director` | `dist/director` |
| التطبيقان | `pnpm build:apps` | `dist/teacher` و`dist/director` |

يمكن تشغيل البناء الموحّد محليًا بأمر `pnpm start`. ويمكن نشر `dist/teacher` و`dist/director` كحزمتين ثابتتين منفصلتين على أي استضافة تدعم SPA وHTTPS.

## أصول الهوية المحلية

لا تتطلب الواجهة أو Manifest خدمة تخزين خارجية بعد اكتمال Phase 2. الأصول الخمسة المحلّية هي:

| المسار | الاستخدام |
|---|---|
| `client/public/assets/khabir-alshawahid-emblem.png` | رمز التطبيق والرأس وشاشة البداية. |
| `client/public/assets/khabir-alshawahid-wordmark.png` | الشعار النصي. |
| `client/public/assets/saudi-ministry-of-education-logo.png` | أغلفة PDF وWord والطباعة والمعاينة. |
| `client/public/assets/khabir-alshawahid-store-icon-192.png` | Manifest/PWA. |
| `client/public/assets/khabir-alshawahid-store-icon-512.png` | Manifest/PWA. |

## التحقق والاختبارات

| الأمر | الحالة النهائية في Phase 2 |
|---|---|
| `pnpm check` | **PASS** في قبول Phase 2 النهائي. |
| `pnpm build` مع متغيري Forge غير معرّفين | **PASS**. |
| بدء التطوير مع متغيري Forge غير معرّفين | **PASS**. |
| `pnpm build:apps` مع متغيري Forge غير معرّفين | **PASS**. |
| `pnpm run verify:apps` | **PASS**. |
| `pnpm test` | **PASS**؛ 29 اختبار وحدة ناجح. |
| `pnpm run test:pwa` | **PASS**؛ Workbox precache وإعادة التحميل دون اتصال تحققا. |
| فحوص التصدير والطباعة والمتصفح | **PASS** عبر فحوص القبول الآلية المتاحة. |
| Android | **PASS (User-verified on real device)**. |
| iPhone | **PASS (User-verified on real device)**. |

## استقلال Forge

لا يوجد Proxy Forge في `vite.config.ts`، ولا استخدام تشغيلي لـ `BUILT_IN_FORGE_API_URL` أو `BUILT_IN_FORGE_API_KEY` في الواجهة أو البناء. **Operational Manus/Forge dependencies = 0**، ولا يلزم أي مفتاح Forge لتشغيل أو بناء التطبيق في الحالة الحالية.

## حدود أدوات الاختبار بين الأنظمة

التطبيق نفسه يعتمد على معايير الويب وNode/pnpm، لكن بعض أدوات الاختبار تحت `scripts/` تتضمن مسارات Linux ثابتة مثل `/home/ubuntu/...` أو تفترض Chromium محليًا. هذه الأدوات ليست تبعية تشغيلية للتطبيق، ولم تكن قابلية نقلها الكاملة إلى Windows/Claude Code شرطًا لإغلاق Phase 2. عند الحاجة، نفّذها كمرحلة منفصلة دون تغيير التطبيق. تم التحقق اليدوي من Android وiPhone بواسطة مالك المشروع على أجهزة فعلية؛ لم تُنفذ هذه الاختبارات داخل بيئة Manus. مرجع التحقق قبل تنظيف Git هو `bdba1af8`.

## ما لا يجب تغييره أثناء النقل

لا تغيّر تخزين IndexedDB أو `localStorage` أو محركات التصدير والطباعة أو المشاركة. لا تحذف OAuth أو Drizzle أو `ManusDialog` أو ملفات الإرث. راجع `MANUS_DEPENDENCY_AUDIT.md` قبل إزالة أي مرجع تاريخي للمنصة.
