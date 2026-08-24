import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3000/", { waitUntil: "domcontentloaded" });
  const splash = page.locator(".app-splash");
  await splash.waitFor();
  await page.waitForFunction(() => [".app-splash-emblem", ".app-splash-wordmark"].every((selector) => {
    const image = document.querySelector(selector);
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  }), undefined, { timeout: 2200 });
  const emblemLoaded = await page.locator(".app-splash-emblem").evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
  const wordmarkLoaded = await page.locator(".app-splash-wordmark").evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
  if (!emblemLoaded || !wordmarkLoaded) throw new Error("شعار شاشة التحميل لم يكتمل تحميله");
  await splash.screenshot({ path: "/home/ubuntu/splash-screen-preview.png" });
  await splash.waitFor({ state: "hidden", timeout: 2500 });
  await page.locator(".phone-topbar").waitFor();
  console.log("Splash screen display and transition passed");
} finally {
  await browser.close();
}
