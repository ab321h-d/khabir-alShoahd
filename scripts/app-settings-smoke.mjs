import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  await page.getByLabel("إعدادات التطبيق").click();
  const settings = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  await settings.getByText("ألوان الواجهة", { exact: true }).waitFor();
  await settings.getByRole("button", { name: /بنفسجي متزن/ }).click();
  await page.waitForFunction(() => document.documentElement.dataset.appTheme === "violet");
  await settings.getByLabel("كلمة مرور جديدة للتطبيق").fill("secure9");
  await settings.getByLabel("تأكيد كلمة مرور التطبيق").fill("secure9");
  await settings.getByRole("button", { name: "تفعيل كلمة المرور", exact: true }).click();
  await settings.getByText("كلمة المرور مفعّلة", { exact: true }).waitFor();
  await settings.getByRole("button", { name: "قفل الآن", exact: true }).click();
  const lock = page.getByRole("main").filter({ hasText: "خبير الشواهد مقفل" });
  await lock.getByRole("heading", { name: "خبير الشواهد مقفل", exact: true }).waitFor();
  await lock.getByLabel("كلمة المرور").fill("secure9");
  await lock.getByRole("button", { name: "فتح التطبيق", exact: true }).click();
  await page.getByLabel("إعدادات التطبيق").waitFor();
  if (await page.evaluate(() => document.documentElement.dataset.appTheme) !== "violet") throw new Error("لم يستمر لون الواجهة المختار بعد فتح القفل");
  console.log("App settings color, password lock, and unlock passed");
} finally {
  await browser.close();
}
