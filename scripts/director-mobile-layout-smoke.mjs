import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3000/director", { waitUntil: "networkidle" });
  await page.locator(".director-shell").waitFor();
  await page.locator(".app-splash").waitFor({ state: "hidden" });
  await page.screenshot({ path: "/home/ubuntu/director-mobile-layout-audit.png", fullPage: false });
  const layout = await page.evaluate(() => {
    const shell = document.querySelector(".director-shell");
    const rail = document.querySelector(".director-rail");
    const shellBox = shell?.getBoundingClientRect();
    const railBox = rail?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      shellDisplay: shell ? getComputedStyle(shell).display : "missing",
      shellLeft: shellBox?.left || 0,
      shellRight: shellBox?.right || 0,
      shellWidth: shellBox?.width || 0,
      railLeft: railBox?.left || 0,
      railRight: railBox?.right || 0,
      railWidth: railBox?.width || 0,
    };
  });
  if (layout.documentWidth > layout.viewportWidth + 1 || layout.shellDisplay !== "block" || layout.shellLeft < -1 || layout.shellRight > layout.viewportWidth + 1 || layout.railLeft < -1 || layout.railRight > layout.viewportWidth + 1 || layout.shellWidth > layout.viewportWidth + 1 || layout.railWidth > layout.viewportWidth + 1) {
    throw new Error(`تجاوز أفقي في واجهة المدير على الجوال: ${JSON.stringify(layout)}`);
  }
  console.log(`Director mobile layout verified: ${JSON.stringify(layout)}`);
} finally {
  await browser.close();
}
