import { chromium } from "playwright-core";

const liteMode = process.env.LITE_MODE === "1";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript((enabled) => {
    localStorage.setItem("khabir-evidence-lite-mode", enabled ? "1" : "0");
  }, liteMode);
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  await page.waitForSelector(".phone-content");
  const metrics = await page.evaluate(async () => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource").map((entry) => ({ name: entry.name.split("/").pop(), transferSize: entry.transferSize || 0 })).sort((first, second) => second.transferSize - first.transferSize);
    const resourceBytes = resources.reduce((total, entry) => total + entry.transferSize, 0);
    const scroller = document.querySelector(".phone-content");
    if (!scroller) throw new Error("Phone scroller is missing");
    const experiencePanel = document.querySelector(".experience-panel");
    const frameTimes = [];
    let previous = performance.now();
    for (let index = 0; index < 24; index += 1) {
      scroller.scrollTop = (index % 2 === 0 ? 1 : -1) * 300 + 320;
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      frameTimes.push(now - previous);
      previous = now;
    }
    scroller.scrollTop = 0;
    return {
      liteMode: document.documentElement.classList.contains("lite-mode"),
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      loadMs: Math.round(navigation.loadEventEnd),
      transferredBytes: resourceBytes,
      redundantMobileIntroHidden: Boolean(experiencePanel && getComputedStyle(experiencePanel).display === "none"),
      largestResources: resources.slice(0, 8),
      maxScrollFrameMs: Math.round(Math.max(...frameTimes)),
      averageScrollFrameMs: Math.round(frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length),
    };
  });
  if (metrics.domContentLoadedMs > 2000) throw new Error(`تحميل واجهة الجوال تجاوز ميزانية 2 ثانية: ${metrics.domContentLoadedMs}ms`);
  if (metrics.transferredBytes > 4_000_000) throw new Error(`نقل موارد التطوير تجاوز ميزانية 4MB: ${metrics.transferredBytes} bytes`);
  if (metrics.maxScrollFrameMs > 45) throw new Error(`تمرير واجهة الجوال تجاوز ميزانية الإطار: ${metrics.maxScrollFrameMs}ms`);
  if (!metrics.redundantMobileIntroHidden) throw new Error("المقدمة المكررة ما زالت ظاهرة على الجوال");
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}
