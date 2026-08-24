import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const checks = [
    { url: "http://127.0.0.1:3000/?step=0", selector: ".bundle-summary span", label: "نص الحزمة" },
    { url: "http://127.0.0.1:3000/?step=0", selector: ".performance-area-lead", label: "شرح إضافة الشاهد" },
    { url: "http://127.0.0.1:3000/?step=1", selector: ".share-cover-summary em", label: "نص الغلاف" },
    { url: "http://127.0.0.1:3000/?step=1", selector: ".share-security-note", label: "نص المشاركة" },
    { url: "http://127.0.0.1:3000/director", selector: ".director-toolbar p", label: "نص مدير التطبيق" },
  ];

  for (const check of checks) {
    await page.goto(check.url, { waitUntil: "domcontentloaded" });
    const target = page.locator(check.selector).first();
    await target.waitFor();
    const fontSize = await target.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    if (fontSize < 11) throw new Error(`${check.label} أصغر من الحد المقروء على الجوال: ${fontSize}px`);
  }

  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "domcontentloaded" });
  const stepRailDirection = await page.locator(".step-rail").evaluate((element) => getComputedStyle(element).direction);
  const stepPositions = await page.locator(".step-dot").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
  if (stepRailDirection !== "ltr" || stepPositions[0] >= stepPositions.at(-1)) throw new Error("Step navigation direction was not reversed from left to right");
  const overflowY = await page.locator(".phone-content").evaluate((element) => getComputedStyle(element).overflowY);
  if (overflowY !== "visible") throw new Error("Mobile navigation still uses a nested scroll container");

  await page.evaluate(() => { document.body.style.paddingBottom = "1000px"; });
  const stickyHeaderOrigin = await page.locator(".phone-topbar").evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((top) => window.scrollTo({ top, behavior: "auto" }), stickyHeaderOrigin + 40);
  await page.waitForTimeout(80);
  const stickyHeaderTop = await page.locator(".phone-topbar").evaluate((element) => element.getBoundingClientRect().top);
  if (Math.abs(stickyHeaderTop) > 1) throw new Error(`Mobile sticky header is not pinned while scrolling: ${stickyHeaderTop}px`);
  await page.goto("http://127.0.0.1:3000/?step=1", { waitUntil: "domcontentloaded" });
  await page.getByLabel("العودة").click();
  await page.locator(".screen-bundle").waitFor();
  await page.getByLabel("إعدادات التطبيق").click();
  const displaySettings = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  await displaySettings.waitFor();
  await page.keyboard.press("Escape");
  await displaySettings.waitFor({ state: "hidden" });
  await page.locator(".screen-bundle").waitFor();

  console.log("Mobile typography smoke test passed");
} finally {
  await browser.close();
}
