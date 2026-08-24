import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sender = await context.newPage();
  await sender.goto("http://127.0.0.1:3000/director", { waitUntil: "domcontentloaded" });
  await sender.locator(".app-splash").waitFor({ state: "hidden", timeout: 2600 }).catch(() => {});
  await sender.getByRole("button", { name: "دعوات التعاون" }).click();
  await sender.getByText("دعوة معلم/ة", { exact: true }).click();
  await sender.getByLabel("اسمك أو صفتك").fill("مدير/ة مدرسة الأمل");
  await sender.getByLabel("اسم المدرسة (اختياري)").fill("مدرسة الأمل");
  await sender.getByRole("button", { name: "إنشاء دعوة ربط" }).click();
  const inviteUrl = await sender.getByLabel("رابط دعوة التعاون").inputValue();
  if (!inviteUrl.includes("#khabir-invite=")) throw new Error("لم يُنشأ رابط دعوة صالح");
  if (!await sender.getByLabel("رمز QR لدعوة الربط").count()) throw new Error("لم يظهر رمز QR لدعوة الربط");
  const invitePayload = JSON.parse(Buffer.from(new URL(inviteUrl).hash.split("=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(invitePayload.verificationCode || "")) throw new Error("لم يُنشأ رمز تحقق محلي صحيح");
  await sender.screenshot({ path: "/home/ubuntu/collaboration-invite-preview.png" });

  const receiver = await context.newPage();
  await receiver.goto(inviteUrl, { waitUntil: "domcontentloaded" });
  await receiver.locator(".app-splash").waitFor({ state: "hidden", timeout: 2600 }).catch(() => {});
  await receiver.getByRole("heading", { name: "استقبال دعوة ربط" }).waitFor();
  if (await receiver.getByRole("button", { name: "قبول الربط" }).isEnabled()) throw new Error("يجب أن يبقى قبول الربط معطلاً قبل إدخال رمز التحقق");
  await receiver.getByLabel("رمز تحقق الدعوة").fill(invitePayload.verificationCode);
  await receiver.getByRole("button", { name: "قبول الربط" }).click();
  const savedContacts = await receiver.evaluate(() => JSON.parse(localStorage.getItem("khabir-collaboration-contacts.v1") || "[]"));
  if (!Array.isArray(savedContacts) || savedContacts.length !== 1 || savedContacts[0].senderName !== "مدير/ة مدرسة الأمل" || savedContacts[0].schoolName !== "مدرسة الأمل") throw new Error("لم تُحفظ دعوة الربط محليًا");
  const managerProfile = await receiver.evaluate(() => JSON.parse(localStorage.getItem("khabir-evidence-manager-share") || "{}"));
  if (managerProfile.name !== "مدير/ة مدرسة الأمل") throw new Error("لم تُحفظ وجهة إرسال المدير محليًا بعد قبول الربط");
  await receiver.goto("http://127.0.0.1:3000/?step=1", { waitUntil: "domcontentloaded" });
  await receiver.getByRole("button", { name: "إنشاء أو استقبال دعوة" }).click();
  await receiver.getByRole("button", { name: /اتصالات المدرسة على هذا الجهاز/ }).click();
  await receiver.getByLabel("حذف اتصال مدير/ة مدرسة الأمل").click();
  if ((await receiver.evaluate(() => JSON.parse(localStorage.getItem("khabir-collaboration-contacts.v1") || "[]"))).length !== 0) throw new Error("لم يُحذف اتصال الربط من الجهاز");
  console.log("Local school link QR, confirmation, acceptance, and removal passed");
  await context.close();
} finally {
  await browser.close();
}
