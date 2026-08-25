#!/usr/bin/env node
/**
 * أداة طرف البائع فقط. لا تُستورَد ولا تُشغَّل من داخل تطبيق العميل (client/)،
 * ولا تدخل ضمن أي حزمة بناء (vite build). تُشغَّل يدويًا بواسطة Node على جهاز
 * البائع فقط، خارج نطاق هذا المستودع في الاستخدام الفعلي.
 *
 * تولّد زوج مفاتيح ECDSA P-256، وتكتب الملفين محليًا:
 *   - private-key.local.json  (المفتاح الخاص — لا يُنقل ولا يُشارك ولا يُرفع لأي مكان)
 *   - public-key.local.json   (المفتاح العام — هذا فقط يُنسخ يدويًا إلى
 *                              client/src/lib/license/licenseConfig.ts)
 *
 * كلا الملفين يُكتبان داخل .local-keys/ المستثناة من Git.
 * لا يحتوي هذا السكربت أي مفتاح ثابت مسبقًا؛ كل تشغيل يولّد زوجًا جديدًا.
 */
import { webcrypto } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputDir = path.resolve(import.meta.dirname, ".local-keys");
mkdirSync(outputDir, { recursive: true });

const keyPair = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);

const privateKeyJwk = await webcrypto.subtle.exportKey("jwk", keyPair.privateKey);
const publicKeyJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);

writeFileSync(path.join(outputDir, "private-key.local.json"), JSON.stringify(privateKeyJwk, null, 2));
writeFileSync(path.join(outputDir, "public-key.local.json"), JSON.stringify(publicKeyJwk, null, 2));

console.log("تم توليد زوج مفاتيح جديد في:", outputDir);
console.log("⚠️  private-key.local.json: احتفظ به بمعزل تام. لا تنقله لهذا المستودع أو أي نظام تحكم إصدارات.");
console.log("انسخ محتوى public-key.local.json يدويًا إلى LICENSE_PUBLIC_KEY_JWK في:");
console.log("  client/src/lib/license/licenseConfig.ts");
