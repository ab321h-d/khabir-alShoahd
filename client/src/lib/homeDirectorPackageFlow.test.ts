import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * PHASE NEXT-1: اختبار معماري مباشر على مصدر Home.tsx — Home.tsx مكوّن ضخم
 * بلا بنية اختبار React Testing Library موجودة أصلًا (فجوة معروفة، مُوثَّقة
 * سابقًا في تدقيق PILOT READINESS)؛ بناء بنية RTL كاملة جديدة لأول مرة
 * لصفحة بهذا الحجم يتجاوز "أقل عدد ممكن من الاختبارات" المطلوب لهذه
 * المرحلة تحديدًا. هذا الاختبار يتحقق مباشرة من مصدر الملف نفسه لإثبات
 * البنود الخمسة المطلوبة، بلا تنفيذ فعلي للمكوّن.
 */
const homeSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pages", "Home.tsx"),
  "utf-8",
);

describe("PHASE NEXT-1: مسار إرسال المدير موحَّد، صفر PDF منفرد", () => {
  it("1) صفر دالة قديمة تُنتِج PDF منفردًا لمسار المدير (shareDirectorPackage/downloadDirectorPackage الأصليتان أُزيلتا)", () => {
    expect(homeSource).not.toContain("const shareDirectorPackage");
    expect(homeSource).not.toContain("const downloadDirectorPackage");
    // صفر بناء PDF منفرد ضمن مسار تجهيز حزمة المدير تحديدًا
    expect(homeSource).not.toMatch(/prepareDirectorPackage[\s\S]{0,400}exportPortfolioPdf/);
  });

  it("2) المشاركة تستخدم ZIP (buildDirectorPackageBlob)، لا PDF منفردًا", () => {
    expect(homeSource).toMatch(/sendDirectorPackage[\s\S]{0,600}navigator\.canShare/);
    expect(homeSource).toMatch(/directorPackageDownloadName\(\)[\s\S]{0,50}type:\s*"application\/zip"/);
  });

  it("3) fallback (عدم دعم navigator.share) يستخدم نفس ZIP، لا PDF", () => {
    // داخل sendDirectorPackage نفسها فقط — استخراج جسم الدالة لتفادي تطابق كاذب مع مسارات أخرى (PDF/Word/طباعة الشخصية)
    const start = homeSource.indexOf("const sendDirectorPackage");
    const end = homeSource.indexOf("\n  return (", start);
    const fnBody = homeSource.slice(start, end === -1 ? undefined : end);
    expect(fnBody).toContain("downloadPortfolioBlob(blob, directorPackageDownloadName())");
    expect(fnBody).not.toContain(".pdf\"");
  });

  it("4) كلا مساري المشاركة والتنزيل (fallback) يستخدمان نفس متغيّر blob المُجهَّز مرة واحدة (preparedDirectorPackage)، صفر بناء مزدوج", () => {
    const start = homeSource.indexOf("const sendDirectorPackage");
    const end = homeSource.indexOf("\n  return (", start);
    const fnBody = homeSource.slice(start, end === -1 ? undefined : end);
    expect(fnBody).toContain("if (!preparedDirectorPackage) return;");
    expect(fnBody).toContain("const { blob } = preparedDirectorPackage;");
    // نفس المتغيّر blob (لا استدعاء إضافي لـbuildDirectorPackageBlob داخل هذه الدالة)
    expect(fnBody).not.toContain("buildDirectorPackageBlob()");
  });

  it("5) نقطة بناء الحزمة الوحيدة (buildDirectorPackageBlob) لا تزال تُستدعى من التجهيز فقط، مطابقة لاسم الحزمة القياسي", () => {
    expect(homeSource).toMatch(/prepareDirectorPackage[\s\S]{0,300}buildDirectorPackageBlob\(\)/);
    expect(homeSource).toContain('directorPackageDownloadName');
  });

  it("6) [تصحيح حرج] صفر await/import ديناميكي قبل بناء File/navigator.share — الاستدعاء يبقى مباشرًا من مسار نقرة المستخدم", () => {
    const start = homeSource.indexOf("const sendDirectorPackage");
    const shareCallIndex = homeSource.indexOf("navigator.share(", start);
    const bodyBeforeShare = homeSource.slice(start, shareCallIndex);
    expect(bodyBeforeShare).not.toContain("await import");
    expect(bodyBeforeShare).not.toContain("await ");
    expect(homeSource).toMatch(/^import \{ directorPackageDownloadName, downloadPortfolioBlob \} from "@\/lib\/exportPortfolio";$/m);
  });

  it("7) نجاح navigator.share ليس شرطًا لإتمام العملية — أي فشل/رفض يُفضي لتنزيل نفس ZIP، صفر PDF", () => {
    const start = homeSource.indexOf("const sendDirectorPackage");
    const end = homeSource.indexOf("\n  return (", start);
    const fnBody = homeSource.slice(start, end === -1 ? undefined : end);
    const rejectionHandlerStart = fnBody.indexOf("(error: unknown) =>");
    const rejectionHandler = fnBody.slice(rejectionHandlerStart);
    expect(rejectionHandler).toContain("downloadPortfolioBlob(blob, directorPackageDownloadName())");
    expect(rejectionHandler).not.toContain(".pdf\"");
  });

  it("8) [تصحيح Blocker] AbortError لا يُستثنى من fallback — صفر مسار 'return بلا تنزيل' في معالج الرفض", () => {
    const start = homeSource.indexOf("const sendDirectorPackage");
    const end = homeSource.indexOf("\n  return (", start);
    const fnBody = homeSource.slice(start, end === -1 ? undefined : end);
    const rejectionHandlerStart = fnBody.indexOf("(error: unknown) =>");
    const rejectionHandler = fnBody.slice(rejectionHandlerStart);
    // صفر فحص خاص لـAbortError يُنهي المعالج مبكرًا بلا تنزيل
    expect(rejectionHandler).not.toContain('error.name === "AbortError"');
    // صفر "return" مبكر قبل استدعاء downloadPortfolioBlob داخل هذا المعالج
    const downloadCallIndex = rejectionHandler.indexOf("downloadPortfolioBlob(blob, directorPackageDownloadName())");
    const beforeDownload = rejectionHandler.slice(0, downloadCallIndex);
    expect(beforeDownload).not.toContain("return;");
  });
});
