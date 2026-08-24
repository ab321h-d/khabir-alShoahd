import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  await page.locator(".performance-area-card").first().waitFor();
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    Object.assign(draft, { schoolName: "مدرسة الاختبار", schoolYear: "1447هـ", teacherName: "معلم الاختبار", updatedAt: "2099-01-01T00:00:00.000Z" });
    localStorage.setItem("khabir-alshawahid.prototype.v1", JSON.stringify(draft));
    localStorage.setItem("khabir-alshawahid.cover-preset.v1", JSON.stringify({ schoolName: "مدرسة الاختبار" }));
    localStorage.setItem("khabir-director-name", "مدير الاختبار");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".performance-area-card").first().waitFor();
  await page.evaluate(async () => {
    const { localImageStore } = await import("/src/lib/evidenceStore.ts");
    await localImageStore.saveEvidenceImages([new File(["test"], "evidence-to-clear.png", { type: "image/png" })], "workshop");
    await localImageStore.saveEvidenceImages([new File(["test"], "school-logo-to-keep.png", { type: "image/png" })], "school-profile");
  });
  await page.getByRole("button", { name: "إعدادات التطبيق" }).click();
  const settings = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  await settings.getByRole("button", { name: "مسح الشواهد والصور فقط", exact: true }).click();
  const clearDialog = page.getByRole("dialog", { name: "مسح الشواهد والصور فقط" });
  const clearAction = clearDialog.getByRole("button", { name: "حذف الشواهد والصور", exact: true });
  if (await clearAction.isEnabled()) throw new Error("لا ينبغي تفعيل مسح الشواهد قبل كتابة التأكيد");
  await clearDialog.getByPlaceholder("حذف").fill("حذف");
  await clearAction.click();
  await page.waitForFunction(() => document.querySelector(".bundle-summary")?.textContent?.includes("0 شواهد"));
  const result = await page.evaluate(async () => {
    const { localImageStore } = await import("/src/lib/evidenceStore.ts");
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    const evidenceImages = await localImageStore.listEvidenceImages("workshop");
    const schoolLogos = await localImageStore.listEvidenceImages("school-profile");
    return { bundleLength: draft?.bundle?.length, schoolName: draft?.schoolName, schoolYear: draft?.schoolYear, teacherName: draft?.teacherName, preset: localStorage.getItem("khabir-alshawahid.cover-preset.v1"), directorName: localStorage.getItem("khabir-director-name"), evidenceCount: evidenceImages.length, schoolLogoCount: schoolLogos.length };
  });
  if (result.bundleLength !== 0 || result.schoolName !== "مدرسة الاختبار" || result.schoolYear !== "1447هـ" || result.teacherName !== "معلم الاختبار") throw new Error("مسح الشواهد لم يحافظ على بيانات المدرسة داخل المسودة");
  if (!result.preset || result.directorName !== "مدير الاختبار") throw new Error("مسح الشواهد حذف تفضيلات أو بيانات المدير");
  if (result.evidenceCount !== 0 || result.schoolLogoCount !== 1) throw new Error("مسح الشواهد لم يفرّق بين صورة الشاهد وشعار المدرسة");
  console.log("Selective evidence and image clearing preserves school data, settings, and logos");
} finally {
  await browser.close();
}
