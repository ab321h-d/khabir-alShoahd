import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  const periodTrigger = page.locator(".evaluation-period-trigger");
  await periodTrigger.waitFor();
  if (!(await periodTrigger.innerText()).includes("للعام الدراسي")) throw new Error("لم يبدأ ملف الأداء بفترة التقويم السنوية الافتراضية");
  await periodTrigger.click();
  await page.getByRole("button", { name: "الفصل الدراسي الثاني", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".evaluation-period-trigger")?.textContent?.includes("الفصل الدراسي الثاني"));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null")?.period === "الفصل الدراسي الثاني");
  await page.reload({ waitUntil: "networkidle" });
  if (!(await page.locator(".evaluation-period-trigger").innerText()).includes("الفصل الدراسي الثاني")) throw new Error("لم تُحفظ فترة التقويم المختارة بعد إعادة التحميل");
  console.log("Evaluation period default, selection, and persistence passed");
} finally {
  await browser.close();
}
