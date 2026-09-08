#!/usr/bin/env node
/**
 * أداة إدارية محلية فقط — توليد زوج مفاتيح ECDSA P-256 لتوقيع بيانات
 * اعتماد تفعيل المدير. لا تُشغَّل أبدًا كجزء من build العميل، ولا تُستورَد
 * من أي كود تحت client/.
 *
 * الاستخدام:
 *   node tools/director-activation/generate-keypair.mjs
 *
 * الناتج:
 *   - المفتاح العام (JWK) يُطبَع على الشاشة — انسخه يدويًا إلى
 *     client/src/lib/directorActivationConfig.ts (DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK).
 *   - المفتاح الخاص يُحفَظ محليًا في:
 *     tools/director-activation/.local-keys/private-key.local.json
 *     (مُستثنًى في .gitignore — لا يُرفَع لأي مستودع، لا يوضع تحت client/).
 */
import { webcrypto } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const crypto = webcrypto;
const here = dirname(fileURLToPath(import.meta.url));
const keysDir = join(here, ".local-keys");
const privateKeyPath = join(keysDir, "private-key.local.json");
const publicKeyPath = join(keysDir, "public-key.local.json");

async function main() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const publicJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", privateKey);

  await mkdir(keysDir, { recursive: true });
  await writeFile(privateKeyPath, JSON.stringify(privateJwk, null, 2), "utf8");
  await writeFile(publicKeyPath, JSON.stringify(publicJwk, null, 2), "utf8");

  console.log("تم توليد زوج مفاتيح جديد في:", keysDir);
  console.log("⚠️  private-key.local.json: احتفظ به بمعزل تام. لا تنقله لهذا المستودع أو أي نظام تحكم إصدارات.");
  console.log("انسخ محتوى public-key.local.json يدويًا إلى DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK في:");
  console.log("  client/src/lib/directorActivationConfig.ts");
  console.log();
  console.log("=== المفتاح العام (JWK) ===");
  console.log(JSON.stringify(publicJwk, null, 2));
}

main().catch((error) => {
  console.error("فشل توليد المفاتيح:", error);
  process.exitCode = 1;
});
