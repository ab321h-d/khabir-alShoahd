import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const outputDir = "/home/ubuntu/khabir-alshawahid-prototype/.tmp-export-smoke";
const fixtureImage = {
  name: "شاهد-اختبار.png",
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=", "base64"),
};
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async () => undefined });
    Object.defineProperty(window, "prompt", { configurable: true, value: () => "backup-test-password" });
  });
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  await page.locator(".app-splash").waitFor({ state: "hidden" });
  await page.locator(".performance-area-card").first().waitFor();
  const firstSetupGuide = page.getByRole("status", { name: "إرشاد الإعدادات الأولى" });
  await firstSetupGuide.waitFor();
  const suggestedHijriYear = await page.evaluate(() => {
    const value = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { year: "numeric" }).formatToParts(new Date()).find((part) => part.type === "year")?.value;
    return value ? new Intl.NumberFormat("ar-SA-u-nu-arab", { useGrouping: false }).format(Number(value)) : "";
  });
  if (!suggestedHijriYear || await page.getByText(new RegExp(`ملف الأداء للعام الدراسي.*${suggestedHijriYear}`)).count() !== 1) throw new Error("Suggested Hijri year was not displayed in the bundle summary");
  await firstSetupGuide.screenshot({ path: `${outputDir}/first-setup-guide.png` });
  await page.screenshot({ path: `${outputDir}/first-setup-screen.png` });
  await firstSetupGuide.getByRole("button", { name: "ليس الآن", exact: true }).click();
  if (await firstSetupGuide.count() !== 0 || await page.evaluate(() => localStorage.getItem("khabir-evidence.first-setup.v1")) !== "skipped") throw new Error("First-run settings guide was not dismissible");
  await page.getByLabel("تعديل العام الدراسي مباشرة").click();
  await page.getByLabel("تحرير العام الدراسي مباشرة").fill("١٤٤٦");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.getByText("ملف الأداء للعام الدراسي ١٤٤٦", { exact: true }).waitFor();
  if (await page.locator(".performance-area-card.is-open").count() !== 0) throw new Error("يجب أن تبدأ بنود الأداء مطوية تلقائيًا");
  const mobileHome = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobileHome.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "domcontentloaded" });
  await mobileHome.getByText("اختر بند الأداء", { exact: false }).waitFor();
  const mobileHeaderHeight = await mobileHome.locator(".phone-topbar").evaluate((element) => element.getBoundingClientRect().height);
  const mobileLogoWidth = await mobileHome.locator(".header-brand-emblem").evaluate((element) => element.getBoundingClientRect().width);
  const mobileTaglineSize = await mobileHome.locator(".header-brand-copy small").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const mobileHeadingSize = await mobileHome.locator(".screen-heading h2").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  const mobileStorageTextSize = await mobileHome.locator(".bundle-summary span").evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  if (mobileHeaderHeight < 58 || mobileHeaderHeight > 68 || mobileLogoWidth < 32 || mobileTaglineSize < 9.5 || mobileHeadingSize < 18 || mobileStorageTextSize < 9.5) throw new Error("Mobile header or readability regression detected");
  await mobileHome.close();
  await page.getByLabel("إعدادات التطبيق").click();
  const displaySettings = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  const liteSwitch = displaySettings.getByRole("switch", { name: /الوضع الخفيف/ });
  await liteSwitch.click();
  await page.waitForFunction(() => document.documentElement.classList.contains("lite-mode") && localStorage.getItem("khabir-evidence-lite-mode") === "1");
  await displaySettings.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.reload({ waitUntil: "networkidle" });
  if (!await page.locator("html.lite-mode").count()) throw new Error("Lite mode preference was not restored");
  await page.getByLabel("إعدادات التطبيق").click();
  await page.getByRole("dialog", { name: "إعدادات التطبيق" }).getByRole("switch", { name: /الوضع الخفيف/, checked: true }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains("lite-mode") && localStorage.getItem("khabir-evidence-lite-mode") === null);
  await page.getByRole("dialog", { name: "إعدادات التطبيق" }).getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.getByRole("button", { name: "تعديل أسماء بنود الأداء", exact: true }).click();
  const performanceAreaEditor = page.getByRole("dialog", { name: "تعديل أسماء بنود الأداء" });
  await performanceAreaEditor.getByLabel("اسم بند استراتيجيات التدريس").fill("التدريس وفق نموذج المدرسة");
  await performanceAreaEditor.getByRole("button", { name: "حفظ الأسماء", exact: true }).click();
  await page.getByText("التدريس وفق نموذج المدرسة", { exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "تطبيق", exact: true }).click();
  await page.getByText("استراتيجيات التدريس", { exact: true }).waitFor();
  await page.getByRole("button", { name: "مطبق", exact: true }).waitFor();
  if (await page.locator(".performance-area-card.is-empty").count() < 1 || await page.locator(".performance-area-card.is-complete").count() < 1) {
    throw new Error("لم تظهر حالات البنود الفارغة والمكتملة داخل الحزمة");
  }
  if (await page.getByText("يحتاج إلى شاهد", { exact: true }).count() < 1 || await page.getByText(/مكتمل: .*شواهد?/).count() < 1) {
    throw new Error("لم تظهر رسائل تنبيه البنود الفارغة أو المكتملة");
  }
  await page.getByRole("button", { name: "تعديل أسماء بنود الأداء", exact: true }).click();
  const dynamicAreaEditor = page.getByRole("dialog", { name: "تعديل أسماء بنود الأداء" });
  await dynamicAreaEditor.getByRole("button", { name: "نقل بند استراتيجيات التدريس إلى الأعلى" }).click();
  await page.waitForFunction(() => {
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    return draft?.performanceAreas?.[2]?.id === "teaching_strategies";
  });
  await dynamicAreaEditor.getByLabel("اسم بند أداء جديد").fill("النمو المهني");
  await dynamicAreaEditor.getByRole("button", { name: "إضافة بند أداء جديد" }).click();
  await dynamicAreaEditor.getByLabel("اسم بند النمو المهني").waitFor();
  await dynamicAreaEditor.getByRole("button", { name: "حفظ الأسماء", exact: true }).click();
  await page.getByText("3 من 12 بنود مكتملة", { exact: true }).waitFor();
  const orderedAreaNames = await page.locator(".performance-area-open strong").evaluateAll((elements) => elements.map((element) => element.textContent?.trim()));
  if (orderedAreaNames[2] !== "استراتيجيات التدريس") throw new Error("لم يتغير ترتيب عرض بنود الأداء بعد النقل");
  const draggedTrainingArea = page.getByLabel("فتح بند استراتيجيات التدريس").locator("xpath=ancestor::section[@draggable='true']");
  const dropTargetArea = page.getByLabel("فتح بند إعداد وتنفيذ خطط التعلم").locator("xpath=ancestor::section[@draggable='true']");
  await draggedTrainingArea.dragTo(dropTargetArea);
  await page.waitForFunction(() => {
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    return draft?.performanceAreas?.[0]?.id === "teaching_strategies";
  });
  await page.getByLabel("فتح بند النمو المهني").click();
  await page.getByLabel("إضافة شاهد إلى النمو المهني").click();
  await page.getByLabel("عنوان الشاهد 4").fill("شاهد نمو مهني");
  await page.getByLabel("حفظ تعديل الشاهد 4").click();
  await page.getByRole("button", { name: "تعديل أسماء بنود الأداء", exact: true }).click();
  const deletionEditor = page.getByRole("dialog", { name: "تعديل أسماء بنود الأداء" });
  page.once("dialog", (dialog) => dialog.accept());
  await deletionEditor.getByRole("button", { name: "حذف بند النمو المهني" }).click();
  await page.waitForFunction(() => {
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    return !draft?.performanceAreas?.some((area) => area.label === "النمو المهني") && draft?.bundle?.some((item) => item.title === "شاهد نمو مهني" && item.performanceArea !== "custom-placeholder");
  });
  await deletionEditor.getByRole("button", { name: "حفظ الأسماء", exact: true }).click();
  const movedEvidenceArea = page.getByLabel("فتح بند استراتيجيات التدريس");
  if (await movedEvidenceArea.getAttribute("aria-expanded") !== "true") await movedEvidenceArea.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("حذف شاهد نمو مهني").click();
  const learningPlansArea = page.getByLabel("فتح بند إعداد وتنفيذ خطط التعلم");
  if (await learningPlansArea.getAttribute("aria-expanded") !== "true") await learningPlansArea.click();
  const [areaPdf] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByLabel("تصدير بند إعداد وتنفيذ خطط التعلم PDF").click(),
  ]);
  await areaPdf.saveAs(`${outputDir}/area-learning-plans.pdf`);
  if (await areaPdf.failure()) throw new Error("تعذر تنزيل PDF لبند أداء محدد");
  const [areaWord] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByLabel("تصدير بند إعداد وتنفيذ خطط التعلم Word").click(),
  ]);
  await areaWord.saveAs(`${outputDir}/area-learning-plans.docx`);
  if (await areaWord.failure()) throw new Error("تعذر تنزيل Word لبند أداء محدد");
  await page.getByLabel("فتح بند أداء الواجبات الوظيفية").click();
  await page.getByLabel("إضافة شاهد إلى أداء الواجبات الوظيفية").click();
  await page.getByLabel("عنوان الشاهد 4").fill("شاهد ميداني معدل");
  await page.getByLabel("إضافة صور للشاهد شاهد جديد").click();
  await page.locator(".local-file-input").nth(1).setInputFiles([fixtureImage, fixtureImage]);
  await page.getByText("2 صور محفوظة", { exact: true }).waitFor();
  await page.getByLabel("حفظ تعديل الشاهد 4").click();
  await page.getByLabel("فتح بند استراتيجيات التدريس").click();
  await page.getByLabel("إضافة صور للشاهد شهادة حضور ورشة").click();
  await page.locator(".local-file-input").nth(1).setInputFiles([fixtureImage, fixtureImage]);
  await page.waitForFunction(() => Array.from(document.querySelectorAll(".bundle-item-copy small")).some((element) => element.textContent?.includes("2 صور")));
  await page.getByLabel("تعديل شهادة حضور ورشة").click();
  await page.getByLabel("عنوان الشاهد 1").fill("شاهد تدريبي معدل");
  await page.getByLabel("حفظ تعديل الشاهد 1").click();
  await page.getByLabel("فتح بند أداء الواجبات الوظيفية").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("حذف شاهد ميداني معدل").click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll("[aria-label]")).some((element) => element.getAttribute("aria-label") === "حذف شاهد ميداني معدل"));
  await page.getByLabel("فتح بند استراتيجيات التدريس").click();
  if (await page.getByText("شاهد ميداني معدل", { exact: true }).count() !== 0 || await page.getByText("شاهد تدريبي معدل", { exact: true }).count() !== 1) throw new Error("Bundle evidence edit or deletion did not persist");
  await page.waitForFunction(() => {
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    return draft?.bundle?.some((item) => item.title === "شاهد تدريبي معدل") && !draft.bundle.some((item) => item.title === "شاهد ميداني معدل");
  });
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  const restoredTrainingArea = page.getByLabel("فتح بند استراتيجيات التدريس");
  if (await restoredTrainingArea.getAttribute("aria-expanded") !== "true") await restoredTrainingArea.click();
  await page.getByText("شاهد تدريبي معدل", { exact: true }).waitFor();
  await page.getByText("استراتيجيات التدريس", { exact: true }).waitFor();
  if (await page.getByText("شاهد ميداني معدل", { exact: true }).count() !== 0) throw new Error("Bundle deletion was not retained after reopening the export screen");
  await page.goto("http://127.0.0.1:3000/?step=1", { waitUntil: "networkidle" });
  await page.getByLabel("إعدادات التطبيق").click();
  const settingsDialog = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  await settingsDialog.getByLabel("اسم المدرسة").fill("مدرسة الرواد الثانوية");
  await settingsDialog.getByLabel("المرحلة التعليمية").fill("المرحلة الثانوية");
  await settingsDialog.getByLabel("مدير/ة المدرسة").fill("الأستاذة نورة العتيبي");
  await settingsDialog.getByLabel("اسم المعلم/المعلمة").fill("أمل السهلي");
  await settingsDialog.locator(".cover-form-grid select").first().selectOption({ label: "معلمة" });
  await settingsDialog.locator(".cover-profile-toggles .cover-principal-toggle").nth(1).click();
  await settingsDialog.getByRole("button", { name: "تم", exact: true }).click();
  await page.getByRole("button", { name: "تخصيص الغلاف", exact: true }).click();
  if (await page.getByLabel("معاينة حية للغلاف").count() !== 0) throw new Error("Cover editor still renders the removed live preview");
  await page.getByLabel("العام الدراسي").fill("١٤٤٧");
  await page.getByLabel("عنوان الغلاف", { exact: true }).selectOption("custom");
  await page.getByLabel("عنوان غلاف مخصص").fill("وثيقة الأداء المهني المتكاملة");
  await page.getByLabel("نوع خط عنوان الغلاف").selectOption("classic");
  await page.getByLabel("حجم عنوان الغلاف").selectOption("large");
  await page.getByRole("button", { name: "يمين", exact: true }).click();
  await page.getByLabel("العام الدراسي").fill("١٤٤٧");
  await page.locator('.cover-settings-dialog input[accept="image/*"]').nth(0).setInputFiles(fixtureImage);
  await page.getByRole("button", { name: /عصري/ }).click();
  await page.getByLabel("لون نص عنوان الغلاف").evaluate((input) => { input.value = "#7A3F92"; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
  if (await page.locator(".template-option.path.is-selected").count() !== 1 || await page.getByLabel("عنوان غلاف مخصص").inputValue() !== "وثيقة الأداء المهني المتكاملة" || await page.getByLabel("نوع خط عنوان الغلاف").inputValue() !== "classic" || await page.getByLabel("حجم عنوان الغلاف").inputValue() !== "large" || await page.getByLabel("لون نص عنوان الغلاف").inputValue() !== "#7a3f92") throw new Error("Quick cover editor did not apply customization");
  await page.getByRole("dialog", { name: "تخصيص غلاف الملف" }).screenshot({ path: `${outputDir}/quick-cover-editor.png` });
  await page.getByRole("button", { name: "معاينة الغلاف", exact: true }).click();
  const coverPreview = page.getByRole("dialog", { name: "معاينة الغلاف" });
  await coverPreview.getByText("وثيقة الأداء المهني المتكاملة", { exact: true }).waitFor();
  const previewMetrics = await coverPreview.locator(".cover-output-preview").evaluate((element) => ({ ratio: element.getBoundingClientRect().width / element.getBoundingClientRect().height, borderTopWidth: getComputedStyle(element).borderTopWidth }));
  const previewTitleColors = await coverPreview.locator(".cover-preview-center h3").evaluate((element) => ({ color: getComputedStyle(element).color, backgroundColor: getComputedStyle(element).backgroundColor }));
  if (await coverPreview.locator(".cover-preview-head").count() !== 1 || await coverPreview.locator(".cover-preview-center").count() !== 1 || await coverPreview.locator(".cover-preview-identity").count() !== 1 || await coverPreview.locator(".cover-preview-identity strong").getByText("أمل السهلي", { exact: true }).count() !== 1 || await coverPreview.getByText("معلمة: أمل السهلي", { exact: true }).count() !== 0 || await coverPreview.locator(".cover-preview-identity span").getByText("العام الدراسي ١٤٤٧", { exact: true }).count() !== 1 || await coverPreview.locator(".cover-font-classic.cover-title-large").count() !== 1 || previewTitleColors.color !== "rgb(122, 63, 146)" || previewMetrics.ratio < 0.68 || previewMetrics.ratio > 0.74 || previewMetrics.borderTopWidth !== "2px" || await coverPreview.locator('.cover-preview-logos img[alt="شعار وزارة التعليم"]').count() !== 1 || await coverPreview.getByText("الأستاذة نورة العتيبي", { exact: true }).count() !== 0) throw new Error("Quick cover preview was not rendered as a full A4 frame");
  await coverPreview.screenshot({ path: `${outputDir}/cover-preview.png` });
  await coverPreview.getByRole("button", { name: "إغلاق", exact: true }).click();
  await page.getByRole("button", { name: "تخصيص الغلاف", exact: true }).click();
  await page.getByRole("button", { name: "حفظ وتطبيق", exact: true }).click();
  await page.goto("http://127.0.0.1:3000/?step=0", { waitUntil: "networkidle" });
  await page.getByText("ملف الأداء للعام الدراسي ١٤٤٧", { exact: true }).waitFor();
  await page.goto("http://127.0.0.1:3000/?step=1", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.setItem("khabir-evidence-manager-share", JSON.stringify({ name: "الأستاذة نورة العتيبي", email: "principal@example.edu.sa", message: "أرفق ملف الأداء للفصل الأول." })));
  await page.reload({ waitUntil: "networkidle" });
  if (await page.getByText("المستلم: الأستاذة نورة العتيبي", { exact: true }).count() !== 1 || await page.getByRole("radio").count() !== 0) throw new Error("Manager sharing card was not simplified");
  if (await page.getByText("Google Drive", { exact: true }).count() || await page.getByText("OneDrive", { exact: true }).count()) throw new Error("Non-functional cloud channels are still shown on the share screen");
  if (await page.locator(".collaboration-share-card").count() !== 0 || await page.getByRole("button", { name: "دعوات التعاون", exact: true }).count() !== 1) throw new Error("Collaboration invitations were not reduced to a compact action");
  const unsupportedPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await unsupportedPage.addInitScript(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
  });
  await unsupportedPage.goto("http://127.0.0.1:3000/?step=1", { waitUntil: "networkidle" });
  if (await unsupportedPage.locator(".share-security-note").count() !== 1) throw new Error("Local-only share security notice was not shown");
  await unsupportedPage.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".share-cover-summary").waitFor();
  await page.getByRole("button", { name: "معاينة الملف", exact: true }).click();
  const mobileCoverPreview = page.getByRole("dialog", { name: "معاينة الغلاف" });
  await mobileCoverPreview.locator(".cover-preview-head").waitFor();
  if (await mobileCoverPreview.locator(".cover-preview-logos img").count() !== 2 || await mobileCoverPreview.getByText("مدرسة الرواد الثانوية", { exact: true }).count() !== 1 || await mobileCoverPreview.locator(".cover-preview-identity strong").getByText("أمل السهلي", { exact: true }).count() !== 1 || await mobileCoverPreview.getByText("معلمة: أمل السهلي", { exact: true }).count() !== 0 || await mobileCoverPreview.locator(".cover-preview-identity span").getByText("العام الدراسي ١٤٤٧", { exact: true }).count() !== 1 || await mobileCoverPreview.getByText("وثيقة الأداء المهني المتكاملة", { exact: true }).count() !== 1 || await mobileCoverPreview.getByText("الأستاذة نورة العتيبي", { exact: true }).count() !== 0) throw new Error("Mobile cover preview did not show the saved cover customization");
  if (await mobileCoverPreview.getByText("استراتيجيات التدريس", { exact: true }).count() || await mobileCoverPreview.getByText("العام الدراسي كاملًا", { exact: true }).count() || await mobileCoverPreview.getByText("ملف إنجاز مهني يوثق الأثر التعليمي", { exact: true }).count()) throw new Error("Mobile cover preview still includes removed or repeated cover metadata");
  await mobileCoverPreview.screenshot({ path: `${outputDir}/mobile-cover-preview.png` });
  await page.evaluate(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }));
  const [mobilePdf] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    mobileCoverPreview.getByRole("button", { name: "تصدير PDF", exact: true }).click(),
  ]);
  await mobilePdf.saveAs(`${outputDir}/mobile-cover-preview.pdf`);
  if (await mobilePdf.failure()) throw new Error("Mobile cover PDF download failed");
  await page.setViewportSize({ width: 1280, height: 900 });
  const nonGetRequests = [];
  page.on("request", (request) => { if (request.method() !== "GET") nonGetRequests.push(`${request.method()} ${request.url()}`); });
  await page.evaluate(() => {
    window.__directPrintHarness = { markup: "", printed: false, shareName: "", shareText: "", shareCount: 0 };
    window.open = () => ({
      opener: window,
      document: {
        open: () => undefined,
        write: (markup) => { window.__directPrintHarness.markup = markup; },
        close: () => undefined,
      },
      focus: () => undefined,
      print: () => { window.__directPrintHarness.printed = true; },
      close: () => undefined,
    });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (payload) => {
      window.__directPrintHarness.shareName = payload.files?.[0]?.name || "";
      window.__directPrintHarness.shareText = payload.text || "";
      window.__directPrintHarness.shareCount = payload.files?.length || 0;
    } });
  });
  await page.waitForTimeout(250);
  if (nonGetRequests.length !== 0 || await page.evaluate(() => window.__directPrintHarness.shareCount !== 0)) throw new Error("The app attempted to share or upload before explicit user action");
  await page.getByRole("button", { name: "إرسال نسخة للمدير", exact: true }).click();
  await page.waitForFunction(() => window.__directPrintHarness.shareCount === 1 && window.__directPrintHarness.shareName === "ملف-الأداء-المهني.pdf" && window.__directPrintHarness.shareText.includes("الأستاذة نورة العتيبي") && window.__directPrintHarness.shareText.includes("principal@example.edu.sa"), { timeout: 60000 });
  await page.evaluate(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false }));
  const [managerFallback] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "إرسال نسخة للمدير", exact: true }).click(),
  ]);
  await managerFallback.saveAs(`${outputDir}/manager-share-fallback.pdf`);
  if (await managerFallback.failure()) throw new Error("Manager sharing fallback download failed");
  await page.evaluate(() => Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true }));
  await page.getByRole("button", { name: "طباعة", exact: true }).click();
  const printDialog = page.getByRole("dialog", { name: "اختيار صور الطباعة" });
  await printDialog.getByText("2 من 2 صور محددة", { exact: true }).waitFor();
  await printDialog.getByRole("button", { name: /صورة الشاهد 1/ }).click();
  await printDialog.getByText("1 من 2 صور محددة", { exact: true }).waitFor();
  await printDialog.getByRole("button", { name: "فتح الطباعة", exact: true }).click();
  await page.waitForFunction(() => window.__directPrintHarness.printed && window.__directPrintHarness.markup.includes("وثيقة الأداء المهني المتكاملة"), { timeout: 30000 });
  const printMarkup = await page.evaluate(() => window.__directPrintHarness.markup);
  if (!printMarkup.includes('dir="rtl"') || !printMarkup.includes("@page { size: A4 portrait; margin: 7mm; }") || !printMarkup.includes("border: 1.5px solid") || !printMarkup.includes("cover-header") || !printMarkup.includes("صور الشاهد") || !printMarkup.includes("وثيقة الأداء المهني المتكاملة") || !printMarkup.includes("أمل السهلي") || !printMarkup.includes("العام الدراسي ١٤٤٧") || printMarkup.includes("التأمل المهني") || printMarkup.includes("ملف إنجاز مهني يوثق الأثر التعليمي") || !printMarkup.includes("text-align: right") || printMarkup.includes("تتم الطباعة من هذا الجهاز") || printMarkup.includes("لا تُرسل الشواهد تلقائيًا") || printMarkup.includes("khabir_alshawahid_logo_color_unified.png")) throw new Error("Direct print document contains internal copy or is missing the full A4 cover frame");
  const printPreview = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await printPreview.setContent(printMarkup, { waitUntil: "load" });
  if (await printPreview.locator(".print-page").count() !== 3) throw new Error("Direct print preview does not contain the expected selected A4 pages");
  await printPreview.pdf({ path: `${outputDir}/direct-print-preview.pdf`, format: "A4", printBackground: true, preferCSSPageSize: true });
  await printPreview.close();
  await page.getByRole("button", { name: "طباعة", exact: true }).click();
  await page.getByRole("dialog", { name: "اختيار صور الطباعة" }).getByRole("button", { name: /إرسال إلى تطبيق الطباعة/ }).click();
  await page.waitForFunction(() => window.__directPrintHarness.shareCount === 1 && window.__directPrintHarness.shareName === "ملف-الأداء-المهني.pdf", { timeout: 60000 });
  await page.evaluate(() => {
    window.__directPrintHarness.shareCount = 0;
    window.prompt = () => "backup-test-password";
  });
  await page.getByRole("button", { name: "حفظ يدوي في Drive", exact: true }).click();
  await page.waitForFunction(() => window.__directPrintHarness.shareCount === 1 && window.__directPrintHarness.shareName === "khabir-alshawahid-complete-backup.json" && window.__directPrintHarness.shareText.includes("Google Drive"), { timeout: 30000 });
  const templates = [["path", "عصري حيوي ومتزن"], ["notebook", "بسيط هادئ ومباشر"], ["formal", "رسمي واضح ومؤسسي"], ["gold", "ذهبي رسمي ومميز"]];
  for (const [templateId, templateName] of templates) {
    if (templateId !== "path") {
      await page.getByRole("button", { name: "تخصيص الغلاف", exact: true }).click();
      await page.getByRole("button", { name: templateName, exact: true }).click();
      if (templateId === "gold" && await page.locator(".template-option.gold.is-selected").count() !== 1) throw new Error("Golden cover template was not selected");
      await page.getByRole("button", { name: "حفظ وتطبيق", exact: true }).click();
    }
    for (const [label, extension] of [["PDF", "pdf"], ["Word", "docx"]]) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        page.getByRole("button", { name: label, exact: true }).click(),
      ]);
      await download.saveAs(`${outputDir}/portfolio-${templateId}.${extension}`);
      const failure = await download.failure();
      if (failure) throw new Error(`${label} download failed for ${templateId}: ${failure}`);
    }
  }
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("khabir-director-local", 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("submissions")) request.result.createObjectStore("submissions", { keyPath: "id" }); };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("submissions", "readwrite");
        transaction.objectStore("submissions").put({ id: "backup-director-fixture", fileName: "ملف-اختبار.pdf", teacherName: "معلم اختبار", importedAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z", size: 12, reviewStatus: "reviewed", reviewLevel: "متحقق", academicTerm: "الأول", comment: "اختبار استعادة محلي", pdf: new Blob(["test-pdf"], { type: "application/pdf" }) });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
      request.onerror = () => reject(request.error);
    });
  });
  const [completeBackupDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: "نسخة شاملة", exact: true }).click(),
  ]);
  const completeBackupPath = `${outputDir}/complete-backup.json`;
  await completeBackupDownload.saveAs(completeBackupPath);
  if (await completeBackupDownload.failure()) throw new Error("تعذر تنزيل النسخة الاحتياطية الشاملة");
  await page.getByLabel("إعدادات التطبيق").click();
  const settingsDialogAtEnd = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  await settingsDialogAtEnd.getByRole("button", { name: "مسح بيانات الجهاز", exact: true }).click();
  const clearDialog = page.getByRole("dialog", { name: "مسح بيانات هذا الجهاز" });
  const clearAction = clearDialog.getByRole("button", { name: "حذف البيانات نهائيًا", exact: true });
  if (await clearAction.isEnabled()) throw new Error("لا ينبغي تفعيل مسح بيانات الجهاز قبل كتابة التأكيد");
  await clearDialog.getByPlaceholder("مسح").fill("مسح");
  await Promise.all([
    page.waitForURL("http://127.0.0.1:3000/", { timeout: 30000 }),
    clearAction.click(),
  ]);
  const localDataState = await page.evaluate(async () => {
    const countStore = (databaseName, storeName) => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) { database.close(); resolve(0); return; }
        const count = database.transaction(storeName, "readonly").objectStore(storeName).count();
        count.onsuccess = () => { database.close(); resolve(count.result); };
        count.onerror = () => { database.close(); reject(count.error); };
      };
      request.onerror = () => reject(request.error);
    });
    return {
      draft: localStorage.getItem("khabir-alshawahid.prototype.v1"),
      preset: localStorage.getItem("khabir-alshawahid.cover-preset.v1"),
      manager: localStorage.getItem("khabir-evidence-manager-share"),
      lite: localStorage.getItem("khabir-evidence-lite-mode"),
      teacherDrafts: await countStore("khabir-alshawahid-local", "drafts"),
      teacherImages: await countStore("khabir-alshawahid-local", "image_assets"),
      directorFiles: await countStore("khabir-director-local", "submissions"),
    };
  });
  if (localDataState.draft || localDataState.preset || localDataState.manager || localDataState.lite || localDataState.teacherDrafts || localDataState.teacherImages || localDataState.directorFiles) {
    throw new Error(`لم تُمسح جميع بيانات الجهاز: ${JSON.stringify(localDataState)}`);
  }
  await page.getByText("محفوظ", { exact: true }).waitFor();
  await page.locator(".data-utility-actions input[type=file]").setInputFiles(completeBackupPath);
  await page.waitForTimeout(1200);
  await page.waitForFunction(async () => {
    const countStore = (databaseName, storeName) => new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => {
        const database = request.result;
        const count = database.transaction(storeName, "readonly").objectStore(storeName).count();
        count.onsuccess = () => { database.close(); resolve(count.result); };
        count.onerror = () => { database.close(); reject(count.error); };
      };
      request.onerror = () => reject(request.error);
    });
    return (await countStore("khabir-alshawahid-local", "image_assets")) >= 4 && (await countStore("khabir-director-local", "submissions")) === 1;
  }, { timeout: 30000 });
  await page.waitForFunction(() => {
    const draft = JSON.parse(localStorage.getItem("khabir-alshawahid.prototype.v1") || "null");
    return draft?.bundle?.some((item) => item.title === "شاهد تدريبي معدل") && draft?.coverTitleColor?.toLowerCase() === "#7a3f92" && draft?.showTeacherRole === false;
  }, { timeout: 30000 });
  const availableAddEvidence = page.getByRole("button", { name: /إضافة شاهد إلى/ }).first();
  if (!await availableAddEvidence.isEnabled()) throw new Error("إضافة الشواهد يجب أن تبقى متاحة بعد الاستعادة وإعادة التحميل");
  const availableFirstArea = page.locator(".performance-area-open").first();
  if (await availableFirstArea.getAttribute("aria-expanded") !== "true") await availableFirstArea.click();
  const availableExport = page.getByLabel(/تصدير بند .* PDF/).first();
  if (!await availableExport.isEnabled()) throw new Error("تصدير بنود الأداء يجب أن يبقى متاحًا بعد الاستعادة وإعادة التحميل");
  await page.getByLabel("إعدادات التطبيق").click();
  const settingsAfterRestore = page.getByRole("dialog", { name: "إعدادات التطبيق" });
  if (await settingsAfterRestore.getByText("التجربة المحلية", { exact: true }).count()) throw new Error("يجب ألا تظهر واجهة تجربة أو انتهاء صلاحية داخل الإعدادات");
  await settingsAfterRestore.getByRole("button", { name: "إغلاق", exact: true }).click();
  console.log(`Generated PDF and DOCX for all cover templates in ${outputDir}`);
} finally {
  await browser.close();
}
