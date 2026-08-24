import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const projectRoot = "/home/ubuntu/khabir-alshawahid-prototype";
const origin = "http://127.0.0.1:4174";
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], { cwd: projectRoot, stdio: "ignore" });

async function waitForPreview() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* ينتظر معاينة ناتج الإنتاج. */ }
    await delay(250);
  }
  throw new Error("تعذر تشغيل معاينة الإنتاج لقياس الأداء");
}

try {
  await waitForPreview();
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/?step=0`, { waitUntil: "networkidle" });
    await page.getByText("اختر البند وأضف الشاهد", { exact: false }).waitFor();
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance.getEntriesByType("resource");
      const transferBytes = resources.reduce((total, item) => total + (item.transferSize || 0), 0);
      return { domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd), loadMs: Math.round(navigation.loadEventEnd), transferBytes, resourceCount: resources.length };
    });
    if (metrics.domContentLoadedMs > 2000) throw new Error(`تحميل بناء الإنتاج تجاوز ميزانية ثانيتين: ${metrics.domContentLoadedMs}ms`);
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  preview.kill("SIGTERM");
}
