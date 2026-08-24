import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  const mobileHeader = mobile.locator(".phone-topbar");
  if (await mobileHeader.getByText("وثّق إنجازاتك", { exact: true }).count() !== 1) throw new Error("عبارة هوية الترويسة غير ظاهرة على الجوال");
  const logoLoaded = await mobile.locator(".header-brand-emblem").evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0);
  if (!logoLoaded) throw new Error("رمز الشعار الرسمي لم يُحمّل داخل الترويسة");
  await mobile.evaluate(() => window.scrollTo(0, 520));
  await mobile.waitForTimeout(120);
  const mobileTop = await mobileHeader.evaluate((element) => Math.round(element.getBoundingClientRect().top));
  if (Math.abs(mobileTop) > 1) throw new Error("ترويسة الجوال لم تبقَ مثبتة أثناء التمرير");

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await desktop.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  const desktopHeader = desktop.locator(".phone-topbar");
  await desktop.locator(".phone-content").evaluate((element) => { element.scrollTop = 180; });
  await desktop.waitForTimeout(120);
  const stuckTop = await desktopHeader.evaluate((element) => Math.round(element.getBoundingClientRect().top));
  await desktop.locator(".phone-content").evaluate((element) => { element.scrollTop = 520; });
  await desktop.waitForTimeout(120);
  const topAfterScroll = await desktopHeader.evaluate((element) => Math.round(element.getBoundingClientRect().top));
  if (Math.abs(topAfterScroll - stuckTop) > 3) throw new Error("ترويسة الحاسب لم تبقَ مثبتة داخل منطقة التمرير");

  console.log("Sticky header visibility and scroll behavior passed");
} finally {
  await browser.close();
}
