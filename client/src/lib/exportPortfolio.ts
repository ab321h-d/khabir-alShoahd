/**
 * Design reminder — ملفات أداء «دفتر منجز» تطبع محليًا بصيغة A4،
 * بعناوين عربية RTL، هوامش هادئة، وصور الشواهد من قاعدة الجهاز فقط.
 */
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { AlignmentType, BorderStyle, Document, ImageRun, Packer, PageBorderDisplay, PageBorderOffsetFrom, PageBorderZOrder, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlignTable, WidthType } from "docx";
import { escapeHtml } from "./sanitize";

export type PortfolioImage = {
  blob: Blob;
  name: string;
  evidenceId: string;
};

export type PortfolioEvidence = {
  id: string;
  title: string;
  type: string;
  performanceArea: string;
};

export type PortfolioPerformanceArea = {
  id: string;
  label: string;
};

export type PortfolioExportData = {
  title: string;
  period: string;
  category: string;
  reflection: string;
  includeReflection: boolean;
  performanceAreas: PortfolioPerformanceArea[];
  evidenceItems: PortfolioEvidence[];
  schoolName: string;
  schoolStage: string;
  principalName: string;
  teacherName: string;
  teacherRole: string;
  showTeacherRole: boolean;
  schoolYear: string;
  coverTemplate: "notebook" | "formal" | "path" | "gold";
  coverColor: string;
  coverNote: string;
  coverTitle: string;
  coverTitleColor: string;
  coverFont: "modern" | "classic" | "simple";
  coverTitleSize: "compact" | "standard" | "large";
  coverTeacherAlignment: "right" | "center" | "left";
  showPrincipalName: boolean;
  schoolLogo: Blob | null;
  authorityLogo: Blob | null;
  images: PortfolioImage[];
};

const ink = "#183D5A";
const sage = "#49846E";
const cream = "#FFF8EE";
const safeColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#2D7DD2";
const formatAcademicYear = (value: string) => value.trim() ? `العام الدراسي ${value.trim().replace(/^العام الدراسي\s*/, "")}` : "";
const formatTeacherIdentity = (role: string, name: string, showRole: boolean) => name.trim() ? (showRole ? `${role.trim() || "المعلم/ة"}: ${name.trim()}` : name.trim()) : (showRole ? role.trim() : "");
const coverFontStack = (font: PortfolioExportData["coverFont"]) => font === "classic" ? "Georgia, 'Times New Roman', Tahoma, Arial, sans-serif" : font === "simple" ? "Arial, Tahoma, sans-serif" : "Tahoma, Arial, sans-serif";
const coverTitlePixels = (size: PortfolioExportData["coverTitleSize"]) => size === "compact" ? 40 : size === "large" ? 56 : 48;
const coverWordSize = (size: PortfolioExportData["coverTitleSize"]) => size === "compact" ? 40 : size === "large" ? 54 : 46;
const coverWordAlignment = (alignment: PortfolioExportData["coverTeacherAlignment"]) => alignment === "right" ? AlignmentType.RIGHT : alignment === "left" ? AlignmentType.LEFT : AlignmentType.CENTER;
const groupEvidenceByArea = (data: PortfolioExportData) => {
  const declaredAreas = data.performanceAreas.length ? data.performanceAreas : Array.from(new Map(data.evidenceItems.map((item) => [item.performanceArea, { id: item.performanceArea, label: item.performanceArea }])).values());
  return declaredAreas.map((area) => ({ area, items: data.evidenceItems.filter((item) => item.performanceArea === area.label) }));
};

const imagesForEvidence = (data: PortfolioExportData, evidenceId: string) => data.images.filter((image) => image.evidenceId === evidenceId);

export const portfolioDownloadName = (extension: "pdf" | "docx") => `ملف-الأداء-المهني.${extension}`;

export const downloadPortfolioBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
};

const makeElement = (html: string) => {
  const element = document.createElement("section");
  element.dir = "rtl";
  element.lang = "ar";
  element.className = "portfolio-print-page";
  element.style.cssText = `
    width: 794px; min-height: 1123px; box-sizing: border-box; padding: 32px;
    background: #fffdf8; color: ${ink}; font-family: Tahoma, Arial, sans-serif;
    direction: rtl; text-align: right; position: relative; overflow: hidden;
  `;
  element.innerHTML = html;
  return element;
};

const coverPage = async (data: PortfolioExportData) => {
  const schoolLogoUrl = data.schoolLogo ? URL.createObjectURL(data.schoolLogo) : null;
  const authorityLogoUrl = data.authorityLogo ? URL.createObjectURL(data.authorityLogo) : null;
  const accent = safeColor(data.coverColor);
  const titleColor = safeColor(data.coverTitleColor);
  const titleBackground = "#FFFFFF";
  const schoolTitle = escapeHtml(data.schoolName || "بيانات المدرسة");
  const schoolDetails = [data.schoolStage, data.showPrincipalName && data.principalName ? `مدير/ة المدرسة: ${data.principalName}` : ""].filter(Boolean).map(escapeHtml).join(" · ");
  const coverTeacherIdentity = escapeHtml(formatTeacherIdentity(data.teacherRole, data.teacherName, data.showTeacherRole));
  const coverAcademicYear = escapeHtml(formatAcademicYear(data.schoolYear));
  const templateStyle = data.coverTemplate === "formal"
    ? `background:#fff;`
    : data.coverTemplate === "path"
      ? `background:radial-gradient(circle at 11% 11%,${accent}1b,transparent 14rem),linear-gradient(145deg,#fffdf8,#f6fbff);`
      : data.coverTemplate === "gold"
        ? `background:radial-gradient(circle at 12% 12%,${accent}1c,transparent 15rem),linear-gradient(145deg,#fffdf4,#fffaf0);`
      : `background:linear-gradient(145deg,#fffdf8,#f7fbf8);`;
  const templateMark = data.coverTemplate === "path" ? `<span style="position:absolute;width:220px;height:102px;border:2px solid ${accent};border-top-color:transparent;border-left-color:transparent;border-radius:50%;left:-62px;bottom:54px;transform:rotate(-18deg)"></span>` : data.coverTemplate === "gold" ? `<span style="position:absolute;top:30px;left:30px;width:54px;height:54px;border-top:3px solid ${accent};border-left:3px solid ${accent};border-radius:8px 0 0 0"></span><span style="position:absolute;bottom:30px;right:30px;width:54px;height:54px;border-bottom:3px solid ${accent};border-right:3px solid ${accent};border-radius:0 0 8px 0"></span>` : "";
  return { element: makeElement(`
  <div style="height:1059px;box-sizing:border-box;display:flex;flex-direction:column;position:relative;overflow:hidden;border:2px solid ${accent};border-radius:14px;${templateStyle};padding:46px;box-shadow:inset 0 0 0 8px #fffdf8,inset 0 0 0 9px ${accent}35">
    <span style="position:absolute;inset:18px;border:1px solid ${accent}45;border-radius:7px;pointer-events:none"></span>
    <span style="position:absolute;top:29px;right:29px;width:54px;height:54px;border-top:3px solid ${accent};border-right:3px solid ${accent};border-radius:0 8px 0 0"></span>
    <span style="position:absolute;bottom:29px;left:29px;width:54px;height:54px;border-bottom:3px solid ${accent};border-left:3px solid ${accent};border-radius:0 0 0 8px"></span>
    <header style="position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:22px;padding:8px 0 24px;border-bottom:1px solid ${accent}44">
      <div><p style="margin:0;color:${accent};font-size:20px;font-weight:700">${schoolTitle}</p>${schoolDetails ? `<p style="margin:7px 0 0;color:#637588;font-size:14px">${schoolDetails}</p>` : ""}</div>
      <div style="display:flex;align-items:center;gap:10px;direction:ltr">${authorityLogoUrl ? `<img src="${authorityLogoUrl}" style="width:64px;height:64px;padding:5px;box-sizing:border-box;border:1px solid ${accent}44;border-radius:12px;background:#fff;object-fit:contain" />` : ""}${schoolLogoUrl ? `<img src="${schoolLogoUrl}" style="width:70px;height:70px;padding:5px;box-sizing:border-box;border:1px solid ${accent}44;border-radius:12px;background:#fff;object-fit:contain" />` : (!authorityLogoUrl ? `<div style="width:64px;height:64px;border-radius:12px;background:${cream};border:1px solid #E3D3BD;display:flex;align-items:center;justify-content:center;color:${sage};font-size:30px">◌</div>` : "")}</div>
    </header>
    <main style="position:relative;z-index:1;display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:${coverFontStack(data.coverFont)}">
      <div style="width:100%;box-sizing:border-box;padding:42px 32px 38px;border:1px solid ${accent}3b;border-radius:15px;background:rgba(255,255,255,.77);box-shadow:0 12px 28px rgba(24,61,90,.05)">
        <div style="width:86px;height:4px;margin:0 auto 25px;border-radius:99px;background:${accent}"></div>
        <h1 style="display:inline-block;max-width:100%;margin:0;padding:6px 14px;border-radius:8px;background:${titleBackground};color:${titleColor};font-size:${coverTitlePixels(data.coverTitleSize)}px;line-height:1.42">${escapeHtml(data.coverTitle || "ملف الأداء المهني")}</h1>
      </div>
    </main>
    ${(coverTeacherIdentity || coverAcademicYear) ? `<footer style="position:relative;z-index:1;align-self:stretch;padding:21px 0 8px;border-top:1px solid ${accent}44;text-align:${data.coverTeacherAlignment}">${coverTeacherIdentity ? `<p style="margin:0;color:${sage};font-size:17px;font-weight:700">${coverTeacherIdentity}</p>` : ""}${coverAcademicYear ? `<p style="margin:8px 0 0;color:#637588;font-size:15px;font-weight:700">${coverAcademicYear}</p>` : ""}</footer>` : ""}
    ${templateMark}
  </div>
`), urls: [schoolLogoUrl, authorityLogoUrl].filter((url): url is string => Boolean(url)) };
};

const overviewPage = (data: PortfolioExportData) => {
  const evidenceGroups = groupEvidenceByArea(data);
  return makeElement(`
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #DCEAF4;padding-bottom:18px"><strong style="font-size:23px">ملخص الحزمة</strong></div>
  <div style="margin-top:40px;padding:28px;border:1px solid #D9E7EE;border-radius:18px;background:#fff">
    <p style="margin:0 0 11px;color:${sage};font-weight:700">عنوان الشاهد</p><h2 style="margin:0;font-size:30px">${escapeHtml(data.title)}</h2>
  </div>
  <section style="margin-top:26px;padding:20px 24px;border:1px solid #D9E7EE;border-radius:18px;background:#fff">
    <p style="margin:0 0 13px;color:${sage};font-size:17px;font-weight:700">شواهد الحزمة</p>
    ${evidenceGroups.length ? evidenceGroups.map(({ area, items }) => {
      const complete = items.length > 0;
      return `<section style="margin:0 0 14px;padding:12px 14px;border-radius:12px;border:1px solid ${complete ? "#CFE5D7" : "#F0CFB8"};background:${complete ? "#F7FBF8" : "#FFF8F3"}"><p style="margin:0 0 5px;color:${complete ? sage : "#B76A39"};font-size:15px;font-weight:700">${escapeHtml(area.label)} <span style="font-size:12px;font-weight:400">— ${complete ? `${items.length} شاهد` : "لا يوجد شاهد مرفق"}</span></p>${complete ? `<ol style="margin:0;padding:0 21px 0 0;color:${ink};font-size:16px;line-height:1.8">${items.map((item) => `<li>${escapeHtml(item.title)} <span style="color:#637588;font-size:13px">— ${escapeHtml(item.type)} · ${imagesForEvidence(data, item.id).length} صور</span></li>`).join("")}</ol>` : ""}</section>`;
    }).join("") : `<p style="margin:0;color:#637588;font-size:17px">لا توجد بنود أداء في هذه الحزمة.</p>`}
  </section>
  ${data.includeReflection && data.reflection.trim() ? `<section style="margin-top:30px"><p style="font-size:20px;line-height:2.1;color:${ink}">${escapeHtml(data.reflection)}</p></section>` : ""}
  <p style="position:absolute;bottom:60px;right:60px;left:60px;margin:0;padding-top:14px;border-top:1px solid #D9E7EE;color:#637588;font-size:13px">عدد الصور المرفقة: ${data.images.length}</p>
`);
};

const imagePage = async (image: PortfolioImage, index: number, total: number, areaLabel: string, evidenceTitle: string) => {
  const dataUrl = URL.createObjectURL(image.blob);
  const element = makeElement(`
    <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #DCEAF4;padding-bottom:18px"><strong style="font-size:22px">${escapeHtml(areaLabel)}</strong><span style="color:${sage};font-size:15px">${index + 1} من ${total}</span></div>
    <p style="margin:15px 0 0;color:${sage};font-size:17px;font-weight:700">الشاهد: ${escapeHtml(evidenceTitle)}</p>
    <div style="height:820px;display:flex;flex-direction:column;justify-content:center;align-items:center">
      <img src="${dataUrl}" style="max-width:100%;max-height:700px;object-fit:contain;border:12px solid white;border-radius:10px;box-shadow:0 14px 36px rgba(24,61,90,.12)" />
      <p style="margin:22px 0 0;color:#637588;font-size:14px">${escapeHtml(image.name)}</p>
    </div>
  `);
  return { element, urls: [dataUrl] };
};

const withHiddenPrintSurface = async <T>(callback: (surface: HTMLDivElement) => Promise<T>) => {
  const surface = document.createElement("div");
  surface.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;z-index:-1;";
  document.body.appendChild(surface);
  try {
    return await callback(surface);
  } finally {
    surface.remove();
  }
};

export const exportPortfolioPdf = async (data: PortfolioExportData): Promise<Blob> => withHiddenPrintSurface(async (surface) => {
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
  const pages: Array<{ element: HTMLElement; urls?: string[] }> = [await coverPage(data), { element: overviewPage(data) }];
  for (const { area, items } of groupEvidenceByArea(data)) {
    for (const item of items) {
      const evidenceImages = imagesForEvidence(data, item.id);
      for (let index = 0; index < evidenceImages.length; index += 1) {
        const image = evidenceImages[index];
        if (image) pages.push(await imagePage(image, index, evidenceImages.length, area.label, item.title));
      }
    }
  }
  for (let index = 0; index < pages.length; index += 1) {
    surface.appendChild(pages[index].element);
    const canvas = await html2canvas(pages[index].element, { scale: 2, backgroundColor: "#fffdf8", useCORS: false });
    const image = canvas.toDataURL("image/jpeg", 0.95);
    if (index > 0) pdf.addPage();
    pdf.addImage(image, "JPEG", 0, 0, 210, 297, undefined, "FAST");
    pages[index].element.remove();
    pages[index].urls?.forEach((url) => URL.revokeObjectURL(url));
  }
  return pdf.output("blob");
});

const rtlParagraph = (text: string, options: { heading?: boolean; accent?: boolean; color?: string } = {}) => new Paragraph({
  bidirectional: true,
  alignment: AlignmentType.RIGHT,
  spacing: { after: options.heading ? 220 : 130, line: 360 },
  children: [new TextRun({ text, bold: options.heading, size: options.heading ? 32 : 24, color: options.color || (options.accent ? "49846E" : "183D5A"), font: "Tahoma", rightToLeft: true })],
});

const wordBorder = (color: string, size = 8) => ({ style: BorderStyle.SINGLE, size, color });
const noWordBorders = { top: { style: BorderStyle.NIL, color: "FFFFFF" }, bottom: { style: BorderStyle.NIL, color: "FFFFFF" }, left: { style: BorderStyle.NIL, color: "FFFFFF" }, right: { style: BorderStyle.NIL, color: "FFFFFF" } };

const coverText = (text: string, options: { size?: number; color?: string; bold?: boolean; font?: string; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: { before?: number; after?: number; line?: number } } = {}) => new Paragraph({
  bidirectional: true,
  alignment: options.alignment || AlignmentType.RIGHT,
  spacing: options.spacing,
  children: [new TextRun({ text, size: options.size || 22, color: options.color || "183D5A", bold: options.bold, font: options.font || "Tahoma", rightToLeft: true })],
});

export const exportPortfolioWord = async (data: PortfolioExportData): Promise<Blob> => {
  const accent = safeColor(data.coverColor).replace("#", "");
  const titleColor = safeColor(data.coverTitleColor).replace("#", "");
  const titleBackground = "FFFFFF";
  const wordTemplate = data.coverTemplate === "formal"
    ? { headerFill: "FFFFFF", cardFill: "FFFFFF", borderColor: accent, borderSize: 18, dividerSize: 12 }
    : data.coverTemplate === "path"
      ? { headerFill: "F4F8FF", cardFill: "F8FBFF", borderColor: accent, borderSize: 12, dividerSize: 10 }
      : data.coverTemplate === "gold"
        ? { headerFill: "FFF7E2", cardFill: "FFFDF5", borderColor: accent, borderSize: 16, dividerSize: 12 }
      : { headerFill: "F7FBF8", cardFill: "FFFDF8", borderColor: "49846E", borderSize: 10, dividerSize: 8 };
  const schoolTitle = data.schoolName || "اسم المدرسة";
  const schoolDetails = [data.schoolStage, data.showPrincipalName && data.principalName ? `مدير/ة المدرسة: ${data.principalName}` : ""].filter(Boolean).join(" · ");
  const coverTeacherIdentity = formatTeacherIdentity(data.teacherRole, data.teacherName, data.showTeacherRole);
  const coverAcademicYear = formatAcademicYear(data.schoolYear);
  const logoRuns: ImageRun[] = [];
  if (data.authorityLogo) {
    const authorityData = await data.authorityLogo.arrayBuffer();
    logoRuns.push(new ImageRun({ data: new Uint8Array(authorityData), transformation: { width: 54, height: 54 }, type: data.authorityLogo.type === "image/png" ? "png" : "jpg" }));
  }
  if (data.schoolLogo) {
    const schoolData = await data.schoolLogo.arrayBuffer();
    logoRuns.push(new ImageRun({ data: new Uint8Array(schoolData), transformation: { width: 60, height: 60 }, type: data.schoolLogo.type === "image/png" ? "png" : "jpg" }));
  }
  const coverHeader = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    visuallyRightToLeft: true,
    borders: { bottom: wordBorder(wordTemplate.borderColor, 8), top: noWordBorders.top, left: noWordBorders.left, right: noWordBorders.right },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 64, type: WidthType.PERCENTAGE }, borders: noWordBorders, shading: { type: ShadingType.CLEAR, fill: wordTemplate.headerFill }, margins: { top: 160, bottom: 160, left: 220, right: 220 }, verticalAlign: VerticalAlignTable.CENTER, children: [
        coverText(schoolTitle, { size: 30, color: accent, bold: true, spacing: { after: 70 } }),
        ...(schoolDetails ? [coverText(schoolDetails, { size: 18, color: "637588" })] : []),
      ] }),
      new TableCell({ width: { size: 36, type: WidthType.PERCENTAGE }, borders: noWordBorders, shading: { type: ShadingType.CLEAR, fill: wordTemplate.headerFill }, margins: { top: 160, bottom: 160, left: 220, right: 220 }, verticalAlign: VerticalAlignTable.CENTER, children: [
        new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 0 }, children: logoRuns.length ? logoRuns : [new TextRun({ text: "◌", size: 42, color: "49846E", font: "Tahoma" })] }),
      ] }),
    ] })],
  });
  const identityCard = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: wordBorder(wordTemplate.borderColor, wordTemplate.borderSize), bottom: wordBorder(wordTemplate.borderColor, wordTemplate.borderSize), left: wordBorder(wordTemplate.borderColor, wordTemplate.borderSize), right: wordBorder(wordTemplate.borderColor, wordTemplate.borderSize) },
    rows: [new TableRow({ children: [new TableCell({
      shading: { type: ShadingType.CLEAR, fill: titleBackground === "FFFFFF" ? wordTemplate.cardFill : titleBackground },
      margins: { top: 300, bottom: 300, left: 320, right: 320 },
      verticalAlign: VerticalAlignTable.CENTER,
      children: [
        coverText(data.coverTitle || "ملف الأداء المهني", { size: coverWordSize(data.coverTitleSize), color: titleColor, bold: true, font: data.coverFont === "classic" ? "Times New Roman" : data.coverFont === "simple" ? "Arial" : "Tahoma", alignment: AlignmentType.CENTER, spacing: { after: 170 } }),
      ],
    })] })],
  });
  const children = [
    coverHeader,
    new Paragraph({ border: { bottom: wordBorder(accent, wordTemplate.dividerSize) }, spacing: { after: 1860 } }),
    identityCard,
    ...(coverTeacherIdentity ? [coverText(coverTeacherIdentity, { size: 21, color: "49846E", bold: true, alignment: coverWordAlignment(data.coverTeacherAlignment), spacing: { before: 280, after: 80 } })] : []),
    ...(coverAcademicYear ? [coverText(coverAcademicYear, { size: 19, color: "637588", bold: true, alignment: coverWordAlignment(data.coverTeacherAlignment), spacing: { after: 2040 } })] : [new Paragraph({ spacing: { after: 2040 } })]),
    new Paragraph({ children: [new PageBreak()] }),
    rtlParagraph("ملخص الحزمة", { heading: true }),
    rtlParagraph(`عنوان الشاهد: ${data.title}`),
  ];
  children.push(rtlParagraph("شواهد الحزمة", { heading: true }));
  if (data.evidenceItems.length) {
    for (const { area, items } of groupEvidenceByArea(data)) {
      children.push(rtlParagraph(`${area.label} — ${items.length ? `${items.length} شاهد` : "يحتاج إلى شاهد"}`, { heading: true, accent: !items.length }));
      if (!items.length) children.push(rtlParagraph("لا يوجد شاهد مرفق لهذا البند.", { accent: true }));
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item) continue;
        const itemImages = imagesForEvidence(data, item.id);
        children.push(rtlParagraph(`${index + 1}. ${item.title} — ${item.type} · ${itemImages.length} صور`));
        for (const image of itemImages) {
          const arrayBuffer = await image.blob.arrayBuffer();
          const type = image.blob.type === "image/png" ? "png" : "jpg";
          children.push(
            rtlParagraph(`${area.label} — صور الشاهد: ${item.title}`, { heading: true, accent: true }),
            rtlParagraph(image.name, { color: "637588" }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: new Uint8Array(arrayBuffer), transformation: { width: 460, height: 320 }, type })] }),
          );
        }
      }
    }
  } else {
    children.push(rtlParagraph("لا توجد شواهد مضافة في هذه الحزمة.", { accent: true }));
  }
  if (data.includeReflection && data.reflection.trim()) children.push(rtlParagraph(data.reflection));
  children.push(rtlParagraph(`عدد الصور المرفقة: ${data.images.length}`, { accent: true }));
  const document = new Document({
    sections: [{
      properties: { page: { margin: { top: 520, right: 520, bottom: 520, left: 520 }, borders: { pageBorders: { display: PageBorderDisplay.FIRST_PAGE, offsetFrom: PageBorderOffsetFrom.PAGE, zOrder: PageBorderZOrder.FRONT }, pageBorderTop: wordBorder(wordTemplate.borderColor, 18), pageBorderRight: wordBorder(wordTemplate.borderColor, 18), pageBorderBottom: wordBorder(wordTemplate.borderColor, 18), pageBorderLeft: wordBorder(wordTemplate.borderColor, 18) } } },
      children,
    }],
  });
  return Packer.toBlob(document);
};
