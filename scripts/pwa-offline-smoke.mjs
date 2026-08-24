import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const projectRoot = "/home/ubuntu/khabir-alshawahid-prototype";
const origin = "http://127.0.0.1:4173";
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  cwd: projectRoot,
  stdio: "ignore",
});

const waitForPreview = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // ينتظر الخادم المحلي حتى يصبح ناتج PWA جاهزًا للمراجعة.
    }
    await delay(250);
  }
  throw new Error("تعذر تشغيل معاينة PWA الإنتاجية");
};

try {
  await waitForPreview();
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${origin}/?step=0`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller), { timeout: 30000 });
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("اختر البند وأضف الشاهد", { exact: false }).waitFor({ timeout: 30000 });
    if (await page.evaluate(() => !document.documentElement.innerText.includes("اختر البند وأضف الشاهد"))) {
      throw new Error("لم تظهر شاشة الحزمة بعد إعادة التحميل دون اتصال");
    }
    console.log("PWA offline shell verified from the production build.");
  } finally {
    await browser.close();
  }
} finally {
  preview.kill("SIGTERM");
}
