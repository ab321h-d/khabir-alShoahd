#!/usr/bin/env node
/**
 * أداة طرف البائع فقط. لا تُستورَد ولا تُشغَّل من داخل تطبيق العميل (client/).
 *
 * الاستخدام:
 *   node scripts/license-tools/sign-license.mjs \
 *     --scope both --months 12 --license-id LIC-2027-0001 \
 *     --private-key ./scripts/license-tools/.local-keys/private-key.local.json
 *
 * تطبع كود التفعيل الجاهز للصق في واجهة التفعيل داخل التطبيق (مرحلة لاحقة).
 * لا تُسجِّل هذه الأداة أي كود أو سر في أي ملف سجلّ (log)؛ الإخراج على
 * الطرفية فقط.
 */
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const scope = getArg("scope", "both");
const months = Number(getArg("months", "3"));
const licenseId = getArg("license-id");
const privateKeyPath = getArg("private-key");

if (!["teacher", "director", "both"].includes(scope)) {
  console.error("خطأ: --scope يجب أن يكون teacher أو director أو both");
  process.exit(1);
}
if (!licenseId) {
  console.error("خطأ: --license-id مطلوب (معرّف فريد لهذا الترخيص)");
  process.exit(1);
}
if (!privateKeyPath) {
  console.error("خطأ: --private-key مطلوب (مسار ملف JWK للمفتاح الخاص، لا يوجد ملف افتراضي في هذا المستودع)");
  process.exit(1);
}

const addCalendarMonths = (date, monthsToAdd) => {
  const totalMonthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + monthsToAdd;
  const targetYear = Math.floor(totalMonthIndex / 12);
  const targetMonthIndex = ((totalMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(date.getUTCDate(), daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonthIndex, clampedDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
};

const toBase64Url = (bytes) => Buffer.from(bytes).toString("base64url");

async function main() {
  const privateKeyJwk = JSON.parse(readFileSync(privateKeyPath, "utf8"));
  const privateKey = await webcrypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const now = new Date();
  const payload = {
    v: 1,
    licenseId,
    scope,
    issuedAt: now.toISOString(),
    expiresAt: addCalendarMonths(now, months).toISOString(),
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes);

  const code = `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signatureBuffer))}`;

  console.log("كود التفعيل:");
  console.log(code);
  console.log();
  console.log("تفاصيل الترخيص:", JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error("فشل توليد كود التفعيل:", error.message);
  process.exit(1);
});
