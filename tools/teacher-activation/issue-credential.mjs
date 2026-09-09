#!/usr/bin/env node
/**
 * أداة إدارية محلية فقط — إصدار بيانات اعتماد تفعيل مدير موقَّعة
 * (ECDSA P-256 / SHA-256). تتطلب المفتاح الخاص المحلي الناتج عن
 * generate-keypair.mjs — لا تُشغَّل كجزء من build العميل، ولا تُستورَد من
 * أي كود تحت client/.
 *
 * الاستخدام:
 *   node tools/teacher-activation/issue-credential.mjs \
 *     --schoolId 1001 --stage elementary --expiresInDays 90 [--activationId <uuid>]
 *
 * الناتج: نص بيانات الاعتماد (base64url(payload).base64url(signature))
 * جاهز لتسليمه للمدير — لا يحتوي أي مادة من المفتاح الخاص نفسه.
 */
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const crypto = webcrypto;
const here = dirname(fileURLToPath(import.meta.url));
const privateKeyPath = join(here, ".local-keys", "private-key.local.json");

const validStages = ["elementary", "middle", "secondary"];

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (key) args[key] = argv[i + 1];
  }
  return args;
};

const bytesToBase64Url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { schoolId, stage, expiresInDays, activationId } = args;

  if (!schoolId || !schoolId.trim()) throw new Error("--schoolId مطلوب");
  if (!stage || !validStages.includes(stage)) throw new Error(`--stage يجب أن يكون واحدًا من: ${validStages.join(", ")}`);
  const days = Number(expiresInDays);
  if (!Number.isFinite(days) || days <= 0) throw new Error("--expiresInDays مطلوب، رقم موجب");

  let privateJwk;
  try {
    privateJwk = JSON.parse(await readFile(privateKeyPath, "utf8"));
  } catch {
    throw new Error(`تعذّرت قراءة المفتاح الخاص المحلي في: ${privateKeyPath}\nشغّل أولًا: node tools/teacher-activation/generate-keypair.mjs`);
  }

  const privateKey = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const now = new Date();
  const payload = {
    version: 1,
    activationId: activationId || crypto.randomUUID(),
    schoolId: schoolId.trim(),
    stage,
    role: "teacher",
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBytes = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payloadBytes));
  const credential = `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(signatureBytes)}`;

  console.log("=== Payload ===");
  console.log(JSON.stringify(payload, null, 2));
  console.log();
  console.log("=== بيانات اعتماد تفعيل المعلم ===");
  console.log(credential);
}

main().catch((error) => {
  console.error("فشل إصدار بيانات الاعتماد:", error.message || error);
  process.exitCode = 1;
});
