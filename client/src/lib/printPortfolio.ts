/**
 * Design reminder — طباعة «دفتر منجز»: صفحة A4 عربية هادئة، غلاف مدرسـي
 * واضح، وصور الشواهد محفوظة داخل المتصفح فقط قبل فتح واجهة طباعة الجهاز.
 */
import type { PortfolioExportData } from "@/lib/exportPortfolio";

const ink = "#183D5A";
const sage = "#49846E";
const cream = "#FFF8EE";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
const safeColor = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#2D7DD2";
const formatAcademicYear = (value: string) => value.trim() ? `العام الدراسي ${value.trim().replace(/^العام الدراسي\s*/, "")}` : "";
const formatTeacherIdentity = (role: string, name: string, showRole: boolean) => name.trim() ? (showRole ? `${role.trim() || "المعلم/ة"}: ${name.trim()}` : name.trim()) : (showRole ? role.trim() : "");

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("تعذر قراءة الصورة للطباعة"));
  reader.onerror = () => reject(new Error("تعذر قراءة الصورة للطباعة"));
  reader.readAsDataURL(blob);
});

const printableDocument = (data: PortfolioExportData, schoolLogo: string | null, authorityLogo: string | null, images: string[]) => {
  const accent = safeColor(data.coverColor);
  const titleColor = safeColor(data.coverTitleColor);
  const titleBackground = "#FFFFFF";
  const schoolDetails = [data.schoolStage, data.showPrincipalName && data.principalName ? `مدير/ة المدرسة: ${data.principalName}` : ""].filter(Boolean).map(escapeHtml).join(" · ");
  const coverTeacherIdentity = escapeHtml(formatTeacherIdentity(data.teacherRole, data.teacherName, data.showTeacherRole));
  const coverAcademicYear = escapeHtml(formatAcademicYear(data.schoolYear));
  const coverFont = data.coverFont === "classic" ? "Georgia, 'Times New Roman', Tahoma, Arial, sans-serif" : data.coverFont === "simple" ? "Arial, Tahoma, sans-serif" : "Tahoma, Arial, sans-serif";
  const titleSize = data.coverTitleSize === "compact" ? "27pt" : data.coverTitleSize === "large" ? "37pt" : "32pt";
  const coverClass = data.coverTemplate === "formal" ? "formal" : data.coverTemplate === "path" ? "path" : data.coverTemplate === "gold" ? "gold" : "notebook";
  const logos = [authorityLogo, schoolLogo].filter((logo): logo is string => Boolean(logo)).map((logo, index) => `<img src="${logo}" alt="${index === 0 ? "شعار الجهة التعليمية" : "شعار المدرسة"}" />`).join("");
  const imagePages = images.map((image, index) => `
    <article class="print-page image-page">
      <header class="page-header"><strong>صور الشاهد</strong><span>${index + 1} من ${images.length}</span></header>
      <figure><img src="${image}" alt="صورة الشاهد ${index + 1}" /><figcaption>${escapeHtml(data.images[index]?.name || `صورة الشاهد ${index + 1}`)}</figcaption></figure>
    </article>
  `).join("");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ملف الأداء المهني</title>
  <style>
    @page { size: A4 portrait; margin: 7mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #eef2f4; color: ${ink}; font-family: Tahoma, Arial, sans-serif; direction: rtl; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-page { min-height: 283mm; position: relative; padding: 8mm; background: #fffdf8; break-after: page; page-break-after: always; overflow: hidden; }
    .print-page:last-child { break-after: auto; page-break-after: auto; }
    .cover { display: flex; min-height: 283mm; flex-direction: column; padding: 14mm; border: 1.5px solid ${accent}; border-radius: 4mm; background: linear-gradient(145deg, #fffdf8, #f7fbf8); }
    .cover::before { content: ""; position: absolute; inset: 11mm; border: .45mm solid ${accent}55; border-radius: 1.6mm; pointer-events: none; }
    .cover.formal { border: 2px solid ${accent}; background: #fff; }
    .cover.path { background: radial-gradient(circle at 10% 12%, ${accent}28, transparent 35mm), linear-gradient(145deg, #fffdf8, #f6fbff); }
    .cover.gold { border-color: ${accent}; background: radial-gradient(circle at 10% 12%, ${accent}22, transparent 35mm), linear-gradient(145deg, #fffdf4, #fffaf0); }
    .cover.path::after { content: ""; position: absolute; left: -20mm; bottom: 18mm; width: 65mm; height: 30mm; border: 2px solid ${accent}; border-top-color: transparent; border-left-color: transparent; border-radius: 50%; transform: rotate(-18deg); }
    .cover.gold::after { content: ""; position: absolute; bottom: 14mm; right: 14mm; width: 17mm; height: 17mm; border-bottom: 1mm solid ${accent}; border-right: 1mm solid ${accent}; border-radius: 0 0 2mm 0; }
    .cover-header { position: relative; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 8mm; padding: 3mm 0 8mm; border-bottom: .45mm solid ${accent}55; }
    .logos { display: flex; min-height: 23mm; align-items: center; gap: 4mm; direction: ltr; color: ${accent}; }
    .logos img { width: 23mm; height: 23mm; padding: 1.5mm; border: .35mm solid ${accent}55; border-radius: 3mm; background: #fff; object-fit: contain; }
    .logo-placeholder { display: grid; width: 20mm; height: 20mm; place-items: center; border-radius: 3mm; background: ${cream}; border: 1px solid #e3d3bd; color: ${sage}; font-size: 10mm; }
    .school-name { margin: 0; color: ${accent}; font-size: 16pt; font-weight: 700; }
    .school-details { margin: 3mm 0 0; color: #637588; font-size: 10pt; line-height: 1.8; }
    .cover-main { position: relative; z-index: 1; display: flex; flex: 1; align-items: center; justify-content: center; text-align: center; }
    .title-panel { width: 100%; padding: 15mm 9mm 13mm; border: .4mm solid ${accent}55; border-radius: 4mm; background: rgba(255,255,255,.78); box-shadow: 0 3mm 8mm rgba(24, 61, 90, .05); }
    .cover h1 { display: inline-block; max-width: 100%; margin: 0; padding: 2mm 4mm; border-radius: 2mm; background: ${titleBackground}; color: ${titleColor}; font-family: ${coverFont}; font-size: ${titleSize}; line-height: 1.45; }
    .accent-line { width: 32mm; height: 1.4mm; margin: 0 auto 8mm; border-radius: 99px; background: ${accent}; }
    .cover-meta { position: relative; z-index: 1; display: grid; gap: 2mm; padding: 7mm 0 2mm; border-top: .45mm solid ${accent}55; color: ${sage}; font-size: 11pt; text-align: ${data.coverTeacherAlignment}; }
    .cover-meta p { margin: 0; }
    .cover-meta p:last-child { color: #637588; font-size: 10pt; }
    .local-note { margin-top: auto; padding-top: 8mm; border-top: 1px solid #d9e7ee; color: #637588; font-size: 9pt; }
    .page-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 6mm; border-bottom: 2px solid #dceaf4; }
    .page-header strong { font-size: 18pt; }
    .page-header span { color: ${sage}; font-size: 10pt; }
    .summary-card { margin-top: 13mm; padding: 10mm; border: 1px solid #d9e7ee; border-radius: 5mm; background: #fff; }
    .label { margin: 0 0 3mm; color: ${sage}; font-size: 10pt; font-weight: 700; }
    .summary-card h2 { margin: 0; font-size: 23pt; }
    .tags { display: flex; flex-wrap: wrap; gap: 3mm; margin-top: 7mm; }
    .tag { padding: 2.5mm 5mm; border-radius: 99px; background: #eaf4ec; color: ${sage}; font-size: 10pt; }
    .tag.secondary { background: #eaf4ff; color: #2d7dd2; }
    .reflection { margin-top: 11mm; break-inside: avoid; page-break-inside: avoid; }
    .reflection p { margin: 0; color: ${ink}; font-size: 13pt; line-height: 2.05; white-space: pre-wrap; }
    .summary-footer { position: absolute; right: 8mm; bottom: 8mm; left: 8mm; padding-top: 4mm; border-top: 1px solid #d9e7ee; color: #637588; font-size: 9pt; }
    .image-page { display: flex; flex-direction: column; }
    figure { display: flex; min-height: 221mm; flex: 1; flex-direction: column; align-items: center; justify-content: center; margin: 0; padding: 7mm 0; }
    figure img { display: block; max-width: 100%; max-height: 196mm; object-fit: contain; border: 3mm solid white; border-radius: 3mm; box-shadow: 0 4mm 10mm rgba(24, 61, 90, .12); }
    figcaption { max-width: 100%; margin-top: 6mm; overflow-wrap: anywhere; color: #637588; font-size: 9pt; text-align: center; }
    @media print { html, body { background: #fff; } .print-page { margin: 0; } }
  </style>
</head>
<body>
  <article class="print-page cover ${coverClass}">
    <header class="cover-header"><div><p class="school-name">${escapeHtml(data.schoolName || "بيانات المدرسة")}</p>${schoolDetails ? `<p class="school-details">${schoolDetails}</p>` : ""}</div><div class="logos">${logos || '<span class="logo-placeholder">◌</span>'}</div></header>
    <main class="cover-main"><div class="title-panel"><div class="accent-line"></div><h1>${escapeHtml(data.coverTitle || "ملف الأداء المهني")}</h1></div></main>
    ${(coverTeacherIdentity || coverAcademicYear) ? `<footer class="cover-meta">${coverTeacherIdentity ? `<p>${coverTeacherIdentity}</p>` : ""}${coverAcademicYear ? `<p>${coverAcademicYear}</p>` : ""}</footer>` : ""}
  </article>
  <article class="print-page">
    <header class="page-header"><strong>ملخص الحزمة</strong></header>
    <section class="summary-card"><p class="label">عنوان الشاهد</p><h2>${escapeHtml(data.title)}</h2></section>
    ${data.includeReflection && data.reflection.trim() ? `<section class="reflection"><p>${escapeHtml(data.reflection)}</p></section>` : ""}
    <p class="summary-footer">عدد الصور المرفقة: ${data.images.length}</p>
  </article>
  ${imagePages}
</body>
</html>`;
};

export const openPortfolioPrintDialog = async (printWindow: Window, data: PortfolioExportData) => {
  const [schoolLogo, authorityLogo, ...images] = await Promise.all([
    data.schoolLogo ? blobToDataUrl(data.schoolLogo) : Promise.resolve(null),
    data.authorityLogo ? blobToDataUrl(data.authorityLogo) : Promise.resolve(null),
    ...data.images.map((image) => blobToDataUrl(image.blob)),
  ]);
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(printableDocument(data, schoolLogo, authorityLogo, images));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 240);
};
