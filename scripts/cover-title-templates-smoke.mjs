import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:3000/?step=1", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "تخصيص الغلاف", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "تخصيص غلاف الملف" });
  const titleInput = dialog.locator('input[aria-label="عنوان الغلاف"]');
  await dialog.getByRole("button", { name: "سجل الإنجاز المهني", exact: true }).click();
  if (await titleInput.inputValue() !== "سجل الإنجاز المهني") throw new Error("لم يملأ قالب العنوان النص الجاهز في الحقل");
  await titleInput.fill("عنوان مخصص للاختبار");
  if (await titleInput.inputValue() !== "عنوان مخصص للاختبار") throw new Error("لم يبق حقل العنوان قابلًا للتعديل بعد اختيار قالب جاهز");
  await dialog.getByRole("button", { name: "حفظ بيانات الغلاف", exact: true }).click();
  await page.getByRole("button", { name: "معاينة", exact: true }).click();
  await page.getByRole("dialog", { name: "معاينة الغلاف" }).getByText("عنوان مخصص للاختبار", { exact: true }).waitFor();
  console.log("Cover title templates support quick selection, free editing, and preview reflection");
} finally {
  await browser.close();
}
