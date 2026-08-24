import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.KHABIR_SCREENSHOT_BASE_URL || "http://127.0.0.1:3000";
const outputDir = "/home/ubuntu/khabir-alshawahid-store-screenshots";
const viewport = { width: 360, height: 640 };
const deviceScaleFactor = 3;

const shots = [
  {
    file: "teacher-01-local-evidence.png",
    url: "/?step=0",
    ready: ".phone-topbar",
    title: "المعلم — وثّق شواهدك محليًا",
    description: "الحزمة وبنود الأداء وشريط التقدم محفوظة على الجهاز.",
  },
  {
    file: "teacher-02-share-export.png",
    url: "/?step=1",
    ready: ".phone-topbar",
    title: "المعلم — صدّر وشارك عند الحاجة",
    description: "واجهة المشاركة والتصدير مع بقاء البيانات محلية أولًا.",
  },
  {
    file: "director-01-local-inbox.png",
    url: "/director",
    ready: ".director-header",
    title: "المدير — استقبل وراجع محليًا",
    description: "صندوق وارد محلي لاستيراد ملفات الأداء دون حسابات.",
  },
  {
    file: "director-02-dashboard.png",
    url: "/director",
    ready: ".director-header",
    beforeCapture: async (page) => {
      await page.getByRole("tab", { name: "المتابعة" }).click();
    },
    title: "المدير — تابع الإنجازات بوضوح",
    description: "لوحة متابعة مجمعة للملفات المحفوظة على جهاز المدير.",
  },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  for (const shot of shots) {
    const page = await context.newPage();
    await page.goto(`${baseUrl}${shot.url}`, { waitUntil: "domcontentloaded" });
    await page.locator(".app-splash").waitFor({ state: "hidden", timeout: 2600 }).catch(() => {});
    await page.locator(shot.ready).waitFor({ timeout: 2600 });
    if (shot.beforeCapture) await shot.beforeCapture(page);
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(outputDir, shot.file) });
    await page.close();
  }
  await context.close();
  await writeFile(path.join(outputDir, "README_AR.md"), `# لقطات متجر خبير الشواهد\n\nهذه اللقطات الحقيقية التُقطت من واجهة التطبيق بدقة 1080×1920 بكسل، وتصلح كبداية للرفع في متاجر التطبيقات العمودية. راجع متطلبات كل متجر قبل الرفع النهائي.\n\n| الملف | التطبيق | الرسالة المقترحة في المتجر |\n| --- | --- | --- |\n${shots.map((shot) => `| \`${shot.file}\` | ${shot.title.split(" — ")[0]} | ${shot.title.split(" — ")[1]} — ${shot.description} |`).join("\n")}\n`);
  console.log(`Store screenshots captured in ${outputDir}`);
} finally {
  await browser.close();
}
