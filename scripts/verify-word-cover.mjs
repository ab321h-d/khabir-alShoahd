import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const file = process.argv[2];
const template = process.argv[3];

if (!file) throw new Error("حدد مسار ملف Word للتحقق منه");

const { stdout: documentXml } = await run("unzip", ["-p", file, "word/document.xml"], { maxBuffer: 8 * 1024 * 1024 });
const { stdout: archiveList } = await run("unzip", ["-l", file], { maxBuffer: 2 * 1024 * 1024 });
const requiredContent = ["مدرسة الرواد الثانوية", "وثيقة الأداء المهني المتكاملة", "أمل السهلي", "العام الدراسي 1447هـ / 2025–2026م", "ملخص الحزمة", "شواهد الحزمة", "استراتيجيات التدريس", "شاهد تدريبي معدل"];
const requiredCoverColors = ["7A3F92", "FFF1D9"];
const forbiddenOutputContent = ["تم إنشاء هذا الملف محليًا", "لا تُرفع الشواهد تلقائيًا", "أضف شاهدًا لهذا البند من شاشة الحزمة.", "التأمل المهني خاص وغير ظاهر في هذه النسخة.", "المجال: استراتيجيات التدريس", "الفترة: العام الدراسي كاملًا", "الأستاذة نورة العتيبي", "ملف إنجاز مهني يوثق الأثر التعليمي", "معلمة: أمل السهلي"];

for (const text of requiredContent) {
  if (!documentXml.includes(text)) throw new Error(`غلاف Word يفتقد النص المطلوب: ${text}`);
}

for (const text of forbiddenOutputContent) {
  if (documentXml.includes(text)) throw new Error(`غلاف Word يتضمن عبارة داخلية غير مخصصة للمخرجات: ${text}`);
}

for (const color of requiredCoverColors) {
  if (!documentXml.toUpperCase().includes(color)) throw new Error(`لم ينتقل لون عنوان الغلاف ${color} إلى ملف Word`);
}

const tableCount = (documentXml.match(/<w:tbl>/g) || []).length;
const hasPageBreak = documentXml.includes('w:type="page"');
const mediaCount = (archiveList.match(/word\/media\//g) || []).length;
const bundleStart = documentXml.indexOf("شواهد الحزمة");
const evidenceStart = documentXml.indexOf("شاهد تدريبي معدل", bundleStart);
const evidenceImageStart = documentXml.indexOf("صور الشاهد: شاهد تدريبي معدل", evidenceStart);
const trainingAreaStart = documentXml.indexOf("استراتيجيات التدريس", bundleStart);
const learningPlansStart = documentXml.indexOf("إعداد وتنفيذ خطط التعلم", bundleStart);
const teacherIdentityStart = documentXml.indexOf("أمل السهلي");
const academicYearStart = documentXml.indexOf("العام الدراسي 1447هـ / 2025–2026م");
const coverTitleStart = documentXml.indexOf("وثيقة الأداء المهني المتكاملة");

if (tableCount < 2) throw new Error("لم يُنشأ جدول الهوية وبطاقة الغلاف في ملف Word");
if (!hasPageBreak) throw new Error("لا يفصل غلاف Word عن ملخص الحزمة بصفحة مستقلة");
if (mediaCount < 2) throw new Error("لم تُضمّن شعارات الهوية في ملف Word");
if (bundleStart < 0 || evidenceStart < bundleStart || evidenceImageStart < evidenceStart) throw new Error("لم يرتب Word الشاهد وصوره بعد بند الأداء التابع له");
if (trainingAreaStart < bundleStart || learningPlansStart < trainingAreaStart) throw new Error("لم يحتفظ Word بترتيب بنود الأداء المخصص");
if (teacherIdentityStart < coverTitleStart) throw new Error("لم ينتقل اسم المعلم إلى موضع الهوية السفلي في غلاف Word");
if (academicYearStart < teacherIdentityStart) throw new Error("لم يظهر العام الدراسي بعد اسم المعلم في غلاف Word");
if (!documentXml.includes('w:jc w:val="right"')) throw new Error("لم تطبق محاذاة اليمين على هوية المعلم في غلاف Word");

if (template) {
  const expectedStyle = {
    notebook: { fill: "F7FBF8", border: "8" },
    formal: { fill: "FFFFFF", border: "18" },
    path: { fill: "F4F8FF", border: "12" },
  }[template];
  if (!expectedStyle) throw new Error(`قالب Word غير معروف: ${template}`);
  if (!documentXml.includes(`w:fill="${expectedStyle.fill}"`)) throw new Error(`لم يُطبق تظليل قالب ${template} في ملف Word`);
  if (!documentXml.includes(`w:sz="${expectedStyle.border}"`)) throw new Error(`لم يُطبق إطار قالب ${template} في ملف Word`);
}

console.log(`Word cover verified${template ? ` (${template})` : ""}: ${tableCount} tables, ${mediaCount} media assets`);
