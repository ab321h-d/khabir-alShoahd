import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Check, Clipboard, Download, FileSpreadsheet, FileText, FolderOpen, LayoutDashboard, LockKeyhole, MessageCircle, PenLine, Printer, Search, Send, Sparkles, Star, Trash2, Upload, UserRound, X } from "lucide-react";
import { directorStore, type AcademicTerm, type DirectorSubmission, type ReviewLevel, type ReviewStatus } from "@/lib/directorStore";
import { buildReportFilterDescription, filterReportRows, hasInvalidDateRange, type ReportScope } from "@/lib/reportFilters";
import { escapeHtml } from "@/lib/sanitize";
import { isDirectorStandalone } from "@/lib/appVariant";
import { brandEmblemUrl } from "@/lib/brand";
import CollaborationInviteDialog from "@/components/CollaborationInviteDialog";
import { inviteFromLocation } from "@/lib/collaborationInvite";
import { getSuggestedHijriYear } from "@/lib/academicYear";

const directorNameStorageKey = "khabir-director-name";
const directorAcademicYearStorageKey = "khabir-director-academic-year";
const whatsAppTemplateStorageKey = "khabir-director-whatsapp-template";
const reviewLabels: Record<ReviewStatus, string> = { new: "بانتظار المراجعة", reviewed: "تمت المراجعة", follow_up: "يحتاج متابعة" };
const reviewLevels: ReviewLevel[] = ["", "متميز", "متحقق", "يحتاج متابعة"];
const academicTermLabels: Record<AcademicTerm, string> = { "": "غير محدد", "الأول": "الفصل الدراسي الأول", "الثاني": "الفصل الدراسي الثاني", "العام الدراسي": "العام الدراسي", "الصيفي": "العام الدراسي" };
const academicTerms: AcademicTerm[] = ["", "الأول", "الثاني", "العام الدراسي"];
type AggregateStats = { total: number; reviewed: number; followUp: number; pending: number; levels: { outstanding: number; achieved: number; followUp: number }; completion: number };
type DirectorStarterAction = "invite" | "review" | "report";
type DirectorStarterTip = { title: string; description: string; action: DirectorStarterAction; actionLabel: string };
type EvaluationStatusSegment = { id: "reviewed" | "follow_up" | "new"; label: string; count: number; percent: number };

const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} كيلوبايت` : `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
const formatDate = (value: string) => new Date(value).toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" });
const termLabel = (value?: AcademicTerm) => academicTermLabels[value || ""];
const aggregateStats = (items: DirectorSubmission[]): AggregateStats => {
  const total = items.length;
  const reviewed = items.filter((item) => item.reviewStatus === "reviewed").length;
  const followUp = items.filter((item) => item.reviewStatus === "follow_up").length;
  const pending = items.filter((item) => item.reviewStatus === "new").length;
  const levels = { outstanding: items.filter((item) => item.reviewLevel === "متميز").length, achieved: items.filter((item) => item.reviewLevel === "متحقق").length, followUp: items.filter((item) => item.reviewLevel === "يحتاج متابعة").length };
  return { total, reviewed, followUp, pending, levels, completion: total ? Math.round((reviewed / total) * 100) : 0 };
};

const evaluationStatusSegments = (stats: AggregateStats): EvaluationStatusSegment[] => {
  const percent = (count: number) => stats.total ? Math.round((count / stats.total) * 100) : 0;
  return [
    { id: "reviewed", label: "تمت مراجعتها", count: stats.reviewed, percent: percent(stats.reviewed) },
    { id: "follow_up", label: "تحتاج متابعة", count: stats.followUp, percent: percent(stats.followUp) },
    { id: "new", label: "بانتظار المراجعة", count: stats.pending, percent: percent(stats.pending) },
  ];
};

const starterTip = (stats: AggregateStats): DirectorStarterTip => {
  if (!stats.total) return { title: "ابدأ بفريق صغير", description: "ادعُ معلمَين أولًا، واطلب من كل واحد توثيق شاهد واحد فقط. لا حسابات ولا رفع تلقائي.", action: "invite", actionLabel: "دعوة المعلمين" };
  if (stats.pending) return { title: "راجع أثر البداية", description: `لديك ${stats.pending} ${stats.pending === 1 ? "ملف بانتظار" : "ملفات بانتظار"} المراجعة. ملاحظة قصيرة منك تشجّع المعلمين على إكمال الحزمة.`, action: "review", actionLabel: "مراجعة الملف التالي" };
  if (stats.followUp) return { title: "حوّل المتابعة إلى تقدم", description: "حدّد خطوة عملية واحدة في كل ملاحظة؛ الوضوح أسهل على المعلم من الملاحظات الطويلة.", action: "review", actionLabel: "فتح المتابعة" };
  return { title: "شارك أثر الفريق", description: "استخدم التقرير التجميعي للاحتفاء بالتقدم ومشاركة الخطوة التالية مع فريقك.", action: "report", actionLabel: "فتح التقرير" };
};

const teamStarterMessage = (directorName: string) => `زملائي وزميلاتي الأعزاء،\n\nيسرّني دعوتكم لاستخدام «خبير الشواهد» لتجميع شواهد الأداء بصورة بسيطة ومحفوظة على جهازكم. لا يحتاج التطبيق إلى حساب، ويمكن البدء بشاهد واحد فقط ثم تصدير ملف PDF عند الجاهزية.\n\nسنبدأ بخطوة خفيفة: افتحوا رابط الدعوة، ثم أضيفوا أول شاهد في البند المناسب.\n\n${directorName ? `مع التقدير، ${directorName}` : "مع التقدير"}`;
const normalizeWhatsAppNumber = (value: string) => value.replace(/[٠-٩]/g, (digit) => "٠١٢٣٤٥٦٧٨٩".indexOf(digit).toString()).replace(/[^\d]/g, "").replace(/^00/, "");
const defaultWhatsAppTemplate = "أهلًا {{teacherName}}،\n\nاطلعت على ملف الأداء المرسل، ويحتاج إلى متابعة بسيطة قبل الاعتماد.\n\n{{comment}}\n\n{{directorName}}";
const renderWhatsAppTemplate = (template: string, submission: DirectorSubmission, directorName: string) => template
  .replaceAll("{{teacherName}}", submission.teacherName || "المعلم/ة")
  .replaceAll("{{directorName}}", directorName ? `مع التقدير، ${directorName}` : "مع التقدير")
  .replaceAll("{{comment}}", submission.comment ? `ملاحظة المدير: ${submission.comment}` : "يرجى مراجعة الشواهد واستكمال ما يلزم.");

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
};

const cleanExportMarkup = (markup: string) => markup
  .replace(/<p[^>]*>تقييم محلي أُعد على جهاز المدير<\/p>/, "")
  .replace(" · أُعد محليًا على جهاز المدير", "");

const reviewDocumentMarkup = (submission: DirectorSubmission, directorName: string) => `<div style="border-bottom:5px solid #49846e;padding-bottom:28px;margin-bottom:38px"><p style="color:#49846e;font-size:18px;margin:0 0 12px">خبير الشواهد للمدير</p><h1 style="font-size:34px;margin:0">ملخص تقييم ملف الأداء</h1><p style="font-size:18px;color:#577084;margin:14px 0 0">تقييم محلي أُعد على جهاز المدير</p></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:19px;line-height:1.8"><div style="background:#f1f8f4;padding:20px;border-radius:14px"><strong>المعلم/ة</strong><br/>${escapeHtml(submission.teacherName || "المعلم/ة")}</div><div style="background:#f4f8fc;padding:20px;border-radius:14px"><strong>تاريخ الاستيراد</strong><br/>${formatDate(submission.importedAt)}</div><div style="background:#f4f8fc;padding:20px;border-radius:14px"><strong>حالة المراجعة</strong><br/>${reviewLabels[submission.reviewStatus]}</div><div style="background:#f1f8f4;padding:20px;border-radius:14px"><strong>التقدير</strong><br/>${submission.reviewLevel || "لم يحدد بعد"}</div></div><div style="margin-top:26px;padding:22px;border:1px solid #d9e6df;border-radius:14px;font-size:20px;line-height:1.9"><strong>تعليق المدير</strong><p style="margin:12px 0 0;color:#577084">${escapeHtml(submission.comment || "لا يوجد تعليق مسجل.")}</p></div><div style="margin-top:120px;border-top:1px solid #d9e6df;padding-top:20px;color:#577084;font-size:17px">أعده: ${escapeHtml(directorName || "مدير/ة المدرسة")} · ${formatDate(new Date().toISOString())}</div>`;

const aggregateReportMarkup = (items: DirectorSubmission[], stats: AggregateStats, title: string, period: string, directorName: string, includeSummary: boolean) => `<section style="direction:rtl;color:#183d5a;font-family:Tahoma,Arial,sans-serif"><header style="border-bottom:5px solid #49846e;padding-bottom:18px;margin-bottom:22px"><p style="margin:0 0 8px;color:#49846e;font-size:14px;font-weight:bold">خبير الشواهد للمدير</p><h1 style="margin:0;font-size:27px">${escapeHtml(title || "تقرير متابعة إنجازات المعلمين")}</h1><p style="margin:9px 0 0;color:#577084;font-size:14px">${escapeHtml(period || "الفترة غير محددة")} · أُعد محليًا على جهاز المدير</p></header>${includeSummary ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-bottom:18px"><div style="padding:11px;border-radius:10px;background:#edf5fc"><small>إجمالي الملفات</small><strong style="display:block;font-size:22px">${stats.total}</strong></div><div style="padding:11px;border-radius:10px;background:#e8f5ed"><small>تمت المراجعة</small><strong style="display:block;font-size:22px">${stats.reviewed}</strong></div><div style="padding:11px;border-radius:10px;background:#fff2e3"><small>يحتاج متابعة</small><strong style="display:block;font-size:22px">${stats.followUp}</strong></div><div style="padding:11px;border-radius:10px;background:#f4f8fc"><small>نسبة الإنجاز</small><strong style="display:block;font-size:22px">${stats.completion}%</strong></div></div>` : ""}<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#183d5a;color:white"><th style="padding:9px;text-align:right">المعلم/ة</th><th style="padding:9px;text-align:right">حالة المراجعة</th><th style="padding:9px;text-align:right">التقدير</th><th style="padding:9px;text-align:right">آخر تحديث</th></tr></thead><tbody>${items.map((item) => `<tr><td style="padding:9px;border-bottom:1px solid #dfe8e3">${escapeHtml(item.teacherName)}</td><td style="padding:9px;border-bottom:1px solid #dfe8e3">${reviewLabels[item.reviewStatus]}</td><td style="padding:9px;border-bottom:1px solid #dfe8e3">${item.reviewLevel || "لم يحدد"}</td><td style="padding:9px;border-bottom:1px solid #dfe8e3">${formatDate(item.updatedAt)}</td></tr>`).join("") || `<tr><td colspan="4" style="padding:20px;text-align:center;color:#708599">لا توجد ملفات ضمن هذا النطاق.</td></tr>`}</tbody></table><footer style="margin-top:28px;padding-top:12px;border-top:1px solid #dfe8e3;color:#577084;font-size:12px">أعده: ${escapeHtml(directorName || "مدير/ة المدرسة")} · ${formatDate(new Date().toISOString())}</footer></section>`;

const buildReviewPdf = async (submission: DirectorSubmission, directorName: string) => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const surface = document.createElement("section");
  surface.dir = "rtl";
  surface.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;min-height:1123px;padding:68px;background:#fffdf8;color:#183d5a;font-family:Tahoma,Arial,sans-serif;box-sizing:border-box;direction:rtl";
  surface.innerHTML = cleanExportMarkup(reviewDocumentMarkup(submission, directorName));
  document.body.appendChild(surface);
  try {
    const canvas = await html2canvas(surface, { scale: 2, backgroundColor: "#fffdf8" });
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 210, 297, undefined, "FAST");
    return pdf.output("blob");
  } finally {
    surface.remove();
  }
};

const buildAggregateReportPdf = async (items: DirectorSubmission[], stats: AggregateStats, title: string, period: string, directorName: string) => {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const pages = items.length ? Array.from({ length: Math.ceil(items.length / 11) }, (_, index) => items.slice(index * 11, index * 11 + 11)) : [[]];
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  for (let index = 0; index < pages.length; index += 1) {
    const surface = document.createElement("section");
    surface.dir = "rtl";
    surface.style.cssText = "position:fixed;left:-10000px;top:0;width:1123px;min-height:794px;padding:48px;background:#fffdf8;color:#183d5a;font-family:Tahoma,Arial,sans-serif;box-sizing:border-box;direction:rtl";
    surface.innerHTML = cleanExportMarkup(aggregateReportMarkup(pages[index], stats, title, period, directorName, index === 0));
    document.body.appendChild(surface);
    try {
      const canvas = await html2canvas(surface, { scale: 2, backgroundColor: "#fffdf8" });
      if (index > 0) pdf.addPage("a4", "landscape");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 297, 210, undefined, "FAST");
    } finally {
      surface.remove();
    }
  }
  return pdf.output("blob");
};

export default function Director() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [submissions, setSubmissions] = useState<DirectorSubmission[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [directorName, setDirectorName] = useState(() => localStorage.getItem(directorNameStorageKey) || "");
  const [directorAcademicYear, setDirectorAcademicYear] = useState(() => localStorage.getItem(directorAcademicYearStorageKey) || getSuggestedHijriYear());
  const [directorAcademicYearEditorOpen, setDirectorAcademicYearEditorOpen] = useState(false);
  const [directorAcademicYearDraft, setDirectorAcademicYearDraft] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [importAcademicTerm, setImportAcademicTerm] = useState<AcademicTerm>("");
  const [file, setFile] = useState<File | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(() => Boolean(inviteFromLocation()));
  const [toast, setToast] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [activeView, setActiveView] = useState<"inbox" | "dashboard" | "report">("inbox");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "status" | "level">("recent");
  const [reportScope, setReportScope] = useState<ReportScope>("all");
  const [reportTitle, setReportTitle] = useState("تقرير متابعة إنجازات المعلمين");
  const [reportPeriod, setReportPeriod] = useState("");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [reportAcademicTerm, setReportAcademicTerm] = useState<AcademicTerm>("");
  const [reportTeacherQuery, setReportTeacherQuery] = useState("");
  const [whatsAppTemplate, setWhatsAppTemplate] = useState(() => localStorage.getItem(whatsAppTemplateStorageKey) || defaultWhatsAppTemplate);
  const [whatsAppTemplateOpen, setWhatsAppTemplateOpen] = useState(false);

  const selected = useMemo(() => submissions.find((submission) => submission.id === selectedId) || null, [submissions, selectedId]);
  const dashboard = useMemo(() => aggregateStats(submissions), [submissions]);
  const evaluationSegments = useMemo(() => evaluationStatusSegments(dashboard), [dashboard]);
  const dashboardChart = useMemo(() => {
    const completed = dashboard.total ? Math.round((dashboard.reviewed / dashboard.total) * 100) : 0;
    const followUp = dashboard.total ? Math.round((dashboard.followUp / dashboard.total) * 100) : 0;
    return { completed, followUp, pending: Math.max(0, 100 - completed - followUp) };
  }, [dashboard]);
  const nextStarterTip = useMemo(() => starterTip(dashboard), [dashboard]);
  const reportFilterOptions = useMemo(() => ({ scope: reportScope, startDate: reportStartDate, endDate: reportEndDate, academicTerm: reportAcademicTerm, teacherNameQuery: reportTeacherQuery }), [reportScope, reportStartDate, reportEndDate, reportAcademicTerm, reportTeacherQuery]);
  const reportHasInvalidDateRange = hasInvalidDateRange(reportStartDate, reportEndDate);
  const reportRows = useMemo(() => filterReportRows(submissions, reportFilterOptions), [submissions, reportFilterOptions]);
  const reportStats = useMemo(() => aggregateStats(reportRows), [reportRows]);
  const reportFilterDescription = useMemo(() => buildReportFilterDescription(reportFilterOptions, termLabel), [reportFilterOptions]);
  const reportPeriodDisplay = useMemo(() => [reportPeriod.trim(), reportFilterDescription].filter(Boolean).join(" · "), [reportPeriod, reportFilterDescription]);
  const reportHasExtraFilters = Boolean(reportStartDate || reportEndDate || reportAcademicTerm || reportTeacherQuery.trim());
  const sortedSubmissions = useMemo(() => {
    const levelWeight: Record<ReviewLevel, number> = { "": 0, "يحتاج متابعة": 1, "متحقق": 2, "متميز": 3 };
    const statusWeight: Record<ReviewStatus, number> = { follow_up: 0, new: 1, reviewed: 2 };
    return [...submissions].sort((a, b) => sortBy === "name" ? a.teacherName.localeCompare(b.teacherName, "ar") : sortBy === "status" ? statusWeight[a.reviewStatus] - statusWeight[b.reviewStatus] : sortBy === "level" ? levelWeight[b.reviewLevel] - levelWeight[a.reviewLevel] : b.updatedAt.localeCompare(a.updatedAt));
  }, [submissions, sortBy]);

  const refresh = async () => {
    const next = await directorStore.list();
    setSubmissions(next);
    setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || null);
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { localStorage.setItem(directorNameStorageKey, directorName); }, [directorName]);
  useEffect(() => { localStorage.setItem(directorAcademicYearStorageKey, directorAcademicYear); }, [directorAcademicYear]);
  useEffect(() => { localStorage.setItem(whatsAppTemplateStorageKey, whatsAppTemplate); }, [whatsAppTemplate]);
  useEffect(() => {
    let live = true; let url = "";
    if (selected) void directorStore.getPdf(selected.id).then((blob) => { if (live && blob) { url = URL.createObjectURL(blob); setPdfUrl(url); } });
    else setPdfUrl("");
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [selected?.id]);

  const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };
  const openDirectorAcademicYearEditor = () => { setDirectorAcademicYearDraft(directorAcademicYear); setDirectorAcademicYearEditorOpen(true); };
  const saveDirectorAcademicYear = () => { setDirectorAcademicYear(directorAcademicYearDraft.trim() || getSuggestedHijriYear()); setDirectorAcademicYearEditorOpen(false); showToast("تم تحديث العام الدراسي للمدير"); };
  const importPdf = async () => {
    if (!file) return showToast("اختر ملف PDF أولًا");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return showToast("يرجى اختيار ملف PDF فقط");
    setWorking(true);
    try {
      const submission = await directorStore.save(file, teacherName, importAcademicTerm);
      await refresh();
      setSelectedId(submission.id);
      setImportOpen(false);
      setFile(null);
      setTeacherName("");
      setImportAcademicTerm("");
      showToast("حُفظ الملف على جهاز المدير فقط");
    } catch { showToast("تعذر حفظ ملف PDF محليًا"); }
    finally { setWorking(false); }
  };

  const updateReview = async (patch: Partial<Pick<DirectorSubmission, "reviewStatus" | "reviewLevel" | "academicTerm" | "comment" | "whatsappNumber" | "whatsappMessage">>) => {
    if (!selected) return;
    const enrichedPatch = patch.reviewStatus === "follow_up" && !selected.whatsappMessage ? { ...patch, whatsappMessage: renderWhatsAppTemplate(whatsAppTemplate, selected, directorName) } : patch;
    const next = await directorStore.update(selected.id, enrichedPatch);
    if (next) setSubmissions((items) => items.map((item) => item.id === next.id ? next : item));
  };

  const exportReview = async (share: boolean) => {
    if (!selected) return;
    setWorking(true);
    try {
      const blob = await buildReviewPdf(selected, directorName);
      const name = `ملخص-تقييم-${selected.teacherName || "ملف-أداء"}.pdf`;
      const pdf = new File([blob], name, { type: "application/pdf" });
      if (share && navigator.canShare?.({ files: [pdf] })) { await navigator.share({ title: "ملخص تقييم الأداء", text: `ملخص تقييم ${selected.teacherName || "ملف الأداء"}`, files: [pdf] }); showToast("فُتحت تطبيقات المشاركة على الجهاز"); }
      else { download(blob, name); showToast("نُزّل ملخص التقييم محليًا"); }
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) showToast("تعذر إنشاء ملخص التقييم"); }
    finally { setWorking(false); }
  };

  const printReview = () => {
    if (!selected) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return showToast("اسمح بفتح نافذة الطباعة ثم حاول مرة أخرى");
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملخص تقييم الأداء</title><style>@page{size:A4;margin:0}body{margin:0;background:#fffdf8;color:#183d5a;font-family:Tahoma,Arial,sans-serif}main{box-sizing:border-box;min-height:297mm;padding:24mm}</style></head><body><main>${cleanExportMarkup(reviewDocumentMarkup(selected, directorName))}</main></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 180);
  };

  const exportAggregateReport = async (share: boolean) => {
    setWorking(true);
    try {
      const blob = await buildAggregateReportPdf(reportRows, reportStats, reportTitle, reportPeriodDisplay, directorName);
      const name = `تقرير-تجميعي-${reportTitle.trim() || "إنجازات-المعلمين"}.pdf`;
      const pdf = new File([blob], name, { type: "application/pdf" });
      if (share && navigator.canShare?.({ files: [pdf] })) { await navigator.share({ title: reportTitle, text: reportPeriodDisplay, files: [pdf] }); showToast("فُتحت تطبيقات المشاركة على الجهاز"); }
      else { download(blob, name); showToast("نُزّل التقرير التجميعي محليًا"); }
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) showToast("تعذر إنشاء التقرير التجميعي"); }
    finally { setWorking(false); }
  };

  const exportAggregateExcel = async () => {
    setWorking(true);
    try {
      const { createAggregateReportExcel } = await import("@/lib/exportAggregateExcel");
      const blob = await createAggregateReportExcel({ rows: reportRows, stats: reportStats, title: reportTitle, filterDescription: reportPeriodDisplay, directorName });
      download(blob, `نتائج-تقرير-${reportTitle.trim() || "إنجازات-المعلمين"}.xlsx`);
      showToast("نُزّل ملف Excel بالنتائج المفلترة محليًا");
    } catch { showToast("تعذر إنشاء ملف Excel"); }
    finally { setWorking(false); }
  };

  const exportTeacherRegister = async (format: "csv" | "excel") => {
    if (!sortedSubmissions.length) return showToast("لا توجد ملفات محلية لتصدير السجل");
    setWorking(true);
    try {
      const { createTeacherRegisterCsv, createTeacherRegisterExcel } = await import("@/lib/exportTeacherRegister");
      const blob = format === "csv" ? createTeacherRegisterCsv(sortedSubmissions) : await createTeacherRegisterExcel(sortedSubmissions);
      download(blob, `سجل-المعلمين-${new Date().toISOString().slice(0, 10)}.${format === "csv" ? "csv" : "xlsx"}`);
      showToast(format === "csv" ? "نُزّل سجل المعلمين CSV محليًا" : "نُزّل سجل المعلمين Excel محليًا");
    } catch { showToast("تعذر إنشاء سجل المعلمين"); }
    finally { setWorking(false); }
  };

  const printAggregateReport = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return showToast("اسمح بفتح نافذة الطباعة ثم حاول مرة أخرى");
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(reportTitle)}</title><style>@page{size:A4 landscape;margin:0}body{margin:0;background:#fffdf8;color:#183d5a;font-family:Tahoma,Arial,sans-serif}main{box-sizing:border-box;min-height:210mm;padding:16mm}</style></head><body><main>${cleanExportMarkup(aggregateReportMarkup(reportRows, reportStats, reportTitle, reportPeriodDisplay, directorName, true))}</main></body></html>`);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 180);
  };

  const removeSelected = async () => {
    if (!selected) return;
    await directorStore.remove(selected.id); await refresh(); showToast("حُذف الملف وتقييمه من هذا الجهاز");
  };

  const clearReportFilters = () => {
    setReportStartDate("");
    setReportEndDate("");
    setReportAcademicTerm("");
    setReportTeacherQuery("");
  };

  const runStarterAction = (action: DirectorStarterAction) => {
    if (action === "invite") return setCollaborationOpen(true);
    if (action === "report") return setActiveView("report");
    const next = submissions.find((submission) => submission.reviewStatus === "new") || submissions.find((submission) => submission.reviewStatus === "follow_up") || submissions[0];
    if (next) setSelectedId(next.id);
    setActiveView("inbox");
  };

  const copyStarterMessage = async () => {
    try {
      await navigator.clipboard.writeText(teamStarterMessage(directorName));
      showToast("نُسخت رسالة البدء؛ شاركها عبر القناة التي تفضلها");
    } catch {
      showToast("تعذر النسخ في هذا المتصفح؛ يمكنك كتابة رسالة البداية يدويًا");
    }
  };

  const openWhatsAppFollowUp = () => {
    if (!selected) return;
    const number = normalizeWhatsAppNumber(selected.whatsappNumber || "");
    if (number.length < 8) return showToast("أضف رقم واتساب صالحًا للمعلم أولًا");
    const message = selected.whatsappMessage?.trim() || renderWhatsAppTemplate(whatsAppTemplate, selected, directorName);
    const popup = window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    if (!popup) showToast("تعذر فتح واتساب؛ اسمح بالنوافذ المنبثقة ثم حاول مرة أخرى");
  };

  return <main className="director-app" dir="rtl">
    <header className="director-header"><a href="/" aria-label={isDirectorStandalone ? "الصفحة الرئيسية لتطبيق المدير" : "العودة إلى تطبيق المعلم"}><ArrowRight size={20} /></a><div className="director-brand"><img src={brandEmblemUrl} alt="" aria-hidden="true" /><span><strong>خبير الشواهد</strong><small>مساحة المدير</small></span></div><button className="director-collaboration-button" type="button" onClick={() => setCollaborationOpen(true)} aria-label="دعوات التعاون"><UserRound size={16} /> دعوة</button></header>
    <section className="director-shell">
      <aside className="director-rail"><div className="director-intro"><span className="director-kicker">مساحة مراجعة هادئة</span><h1>قيّم الإنجاز،<br />بوضوح وبساطة.</h1><p>استورد نسخة PDF التي تصلك من المعلم، ثم سجّل تقييمك. لا تُرفع الملفات أو التعليقات إلى أي خدمة.</p></div><button className="director-import-button" type="button" onClick={() => setImportOpen(true)}><Upload size={19} /> استيراد ملف PDF</button><div className="director-trust"><LockKeyhole size={18} /><span><strong>لا حسابات ولا مزامنة</strong><small>كل ملف وتقييم يبقيان على هذا الجهاز.</small></span></div></aside>
      <section className="director-workspace">
        {activeView === "dashboard" && <section className="dashboard-status-chart" aria-label="رسم حالة الملفات"><div className="dashboard-donut" role="img" aria-label={`رسم مقارنة حالة الملفات: مكتملة ${dashboardChart.completed}%، تحتاج متابعة ${dashboardChart.followUp}%، بانتظار المراجعة ${dashboardChart.pending}%`} style={{ background: `conic-gradient(#49846e 0 ${dashboardChart.completed}%, #c37a35 ${dashboardChart.completed}% ${dashboardChart.completed + dashboardChart.followUp}%, #9baab5 ${dashboardChart.completed + dashboardChart.followUp}% 100%)` }}><div><strong>{dashboardChart.completed}%</strong><small>مكتملة</small></div></div><div className="dashboard-chart-copy"><span>مقارنة سريعة</span><h3>حالة الملفات المستلمة</h3><p>يتحدث الرسم تلقائيًا عند مراجعة الملفات أو تحويلها إلى متابعة.</p><div><b className="is-complete">مكتملة <strong>{dashboard.reviewed}</strong></b><b className="is-follow-up">تحتاج متابعة <strong>{dashboard.followUp}</strong></b><b className="is-pending">بانتظار المراجعة <strong>{dashboard.pending}</strong></b></div></div></section>}
        {activeView === "dashboard" && <section className="teacher-register-export" aria-label="تصدير سجل المعلمين"><div><FileSpreadsheet size={20} /><span><strong>سجل المعلمين المحلي</strong><small>يتضمن أسماء المعلمين وحالة ملفاتهم وتواريخ المراجعة، من هذا الجهاز فقط.</small></span></div><section><button type="button" onClick={() => { void exportTeacherRegister("csv"); }} disabled={working || !sortedSubmissions.length}>تنزيل CSV</button><button type="button" onClick={() => { void exportTeacherRegister("excel"); }} disabled={working || !sortedSubmissions.length}><FileSpreadsheet size={15} /> تنزيل سجل Excel</button></section></section>}
        {activeView === "inbox" && <button className="whatsapp-template-settings-button" type="button" onClick={() => setWhatsAppTemplateOpen(true)}><MessageCircle size={16} /> إعداد قالب واتساب الافتراضي</button>}
        {activeView !== "report" && <section className="evaluation-status-panel" aria-label="ملخص حالة تقييم الملفات"><div className="evaluation-status-heading"><span>حالة التقييم</span><strong>{dashboard.completion}% مكتمل</strong><small>{dashboard.reviewed} من {dashboard.total} ملفات تمت مراجعتها</small></div><div className="evaluation-track" role="progressbar" aria-label="نسبة تقييم الملفات" aria-valuemin={0} aria-valuemax={100} aria-valuenow={dashboard.completion}>{evaluationSegments.map((segment) => segment.percent > 0 && <i key={segment.id} className={`is-${segment.id}`} style={{ width: `${segment.percent}%` }} />)}</div><div className="evaluation-legend">{evaluationSegments.map((segment) => <span key={segment.id} className={`is-${segment.id}`}><i />{segment.label}<strong>{segment.count}</strong></span>)}</div></section>}
        {activeView === "inbox" && <section className="director-starter-panel" aria-label="خطوة البداية للمدير"><div className="director-starter-icon"><Sparkles size={20} /></div><div className="director-starter-copy"><span>الخطوة التالية المقترحة</span><h3>{nextStarterTip.title}</h3><p>{nextStarterTip.description}</p></div><div className="director-starter-actions"><button className="director-starter-primary" type="button" onClick={() => runStarterAction(nextStarterTip.action)}>{nextStarterTip.actionLabel}<ArrowLeft size={16} /></button>{!submissions.length && <button className="director-starter-secondary" type="button" onClick={() => { void copyStarterMessage(); }}><Clipboard size={16} /> نسخ رسالة بداية</button>}</div></section>}
        <div className="director-toolbar"><div><p>{activeView === "report" ? "معاينة قبل التصدير" : activeView === "dashboard" ? "تقرير تجميعي محلي" : "صندوق الوارد المحلي"}</p><h2>{activeView === "report" ? "التقرير التجميعي" : activeView === "dashboard" ? "لوحة المتابعة" : `${submissions.length} ${submissions.length === 1 ? "ملف" : "ملفات"}`}</h2><section className="director-academic-year" aria-label="العام الدراسي للمدير"><span>العام الدراسي</span>{directorAcademicYearEditorOpen ? <form onSubmit={(event) => { event.preventDefault(); saveDirectorAcademicYear(); }}><input aria-label="تحرير العام الدراسي للمدير" value={directorAcademicYearDraft} onChange={(event) => setDirectorAcademicYearDraft(event.target.value)} placeholder="١٤٤٨" autoFocus /><button type="submit">حفظ</button><button type="button" onClick={() => setDirectorAcademicYearEditorOpen(false)} aria-label="إلغاء تعديل العام الدراسي للمدير">إلغاء</button></form> : <div><strong>{directorAcademicYear}</strong><button type="button" onClick={openDirectorAcademicYearEditor} aria-label="تعديل العام الدراسي للمدير" title="تعديل العام الدراسي"><PenLine size={14} /></button></div>}</section></div><div className="director-toolbar-actions"><div className="director-view-tabs" role="tablist" aria-label="طرق عرض المدير"><button type="button" role="tab" aria-selected={activeView === "inbox"} className={activeView === "inbox" ? "is-active" : ""} onClick={() => setActiveView("inbox")}><FolderOpen size={15} /> الوارد</button><button type="button" role="tab" aria-selected={activeView === "dashboard"} className={activeView === "dashboard" ? "is-active" : ""} onClick={() => setActiveView("dashboard")}><LayoutDashboard size={15} /> المتابعة</button><button type="button" role="tab" aria-selected={activeView === "report"} className={activeView === "report" ? "is-active" : ""} onClick={() => setActiveView("report")}><FileText size={15} /> التقرير</button></div><label className="director-name"><UserRound size={16} /><input value={directorName} onChange={(event) => setDirectorName(event.target.value)} placeholder="اسم مدير/ة المدرسة" /></label></div></div>
        {activeView === "dashboard" && <section className="director-dashboard" aria-label="لوحة متابعة الإنجازات"><div className="dashboard-stats"><article><span><FileText size={18} /></span><small>إجمالي الملفات</small><strong>{dashboard.total}</strong></article><article className="is-reviewed"><span><Check size={18} /></span><small>تمت المراجعة</small><strong>{dashboard.reviewed}</strong></article><article className="is-followup"><span><BarChart3 size={18} /></span><small>يحتاج متابعة</small><strong>{dashboard.followUp}</strong></article><article><span><Star size={18} /></span><small>نسبة الإنجاز</small><strong>{dashboard.completion}%</strong></article></div><div className="dashboard-summary"><div><p>تقدم المراجعة</p><strong>{dashboard.reviewed} من {dashboard.total || 0} ملفات</strong><span className="dashboard-track"><i style={{ width: `${dashboard.completion}%` }} /></span></div><div className="level-breakdown"><span><i className="outstanding" /> متميز <strong>{dashboard.levels.outstanding}</strong></span><span><i className="achieved" /> متحقق <strong>{dashboard.levels.achieved}</strong></span><span><i className="followup" /> يحتاج متابعة <strong>{dashboard.levels.followUp}</strong></span><span><i className="pending" /> بانتظار المراجعة <strong>{dashboard.pending}</strong></span></div></div><div className="dashboard-compare-heading"><div><h3>مقارنة ملفات المعلمين</h3><p>المؤشرات ناتجة من الملفات المحفوظة على هذا الجهاز فقط.</p></div><label><span>فرز حسب</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="recent">الأحدث</option><option value="name">اسم المعلم</option><option value="status">حالة المراجعة</option><option value="level">التقدير</option></select></label></div>{sortedSubmissions.length ? <div className="dashboard-compare-list">{sortedSubmissions.map((submission) => <button key={submission.id} type="button" onClick={() => { setSelectedId(submission.id); setActiveView("inbox"); }}><span><strong>{submission.teacherName}</strong><small>{formatDate(submission.updatedAt)}</small></span><em className={submission.reviewStatus}>{reviewLabels[submission.reviewStatus]}</em><b className={submission.reviewLevel ? "has-level" : ""}>{submission.reviewLevel || "لم يحدد"}</b></button>)}</div> : <div className="dashboard-empty"><LayoutDashboard size={27} /><strong>لا توجد بيانات بعد</strong><span>استورد ملف أداء لتظهر مؤشرات المتابعة هنا.</span></div>}</section>}
        {activeView === "report" && <section className="aggregate-report-page" aria-label="معاينة التقرير التجميعي">
          <div className="aggregate-report-controls">
            <label><span>عنوان التقرير</span><input value={reportTitle} onChange={(event) => setReportTitle(event.target.value.slice(0, 90))} /></label>
            <label><span>الفترة أو المناسبة</span><input value={reportPeriod} onChange={(event) => setReportPeriod(event.target.value.slice(0, 80))} placeholder="مثال: الفصل الدراسي الأول 1447هـ" /></label>
            <fieldset><legend>نطاق الملفات</legend><div>{([['all', 'كل الملفات'], ['reviewed', 'تمت مراجعتها'], ['follow_up', 'تحتاج متابعة']] as const).map(([value, label]) => <button key={value} type="button" className={reportScope === value ? "is-selected" : ""} onClick={() => setReportScope(value)}>{label}</button>)}</div></fieldset>
            <label className="aggregate-teacher-search"><span>البحث باسم المعلم</span><div className="aggregate-teacher-input"><Search size={15} aria-hidden="true" /><input type="search" aria-label="البحث باسم المعلم في التقرير" value={reportTeacherQuery} onChange={(event) => setReportTeacherQuery(event.target.value.slice(0, 80))} placeholder="اكتب الاسم أو جزءًا منه" /></div></label>
            <fieldset className="aggregate-date-filter"><legend>تاريخ استيراد الملف</legend><div className="aggregate-date-inputs"><label><span>من</span><input type="date" aria-label="من تاريخ الاستيراد" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} /></label><label><span>إلى</span><input type="date" aria-label="إلى تاريخ الاستيراد" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} /></label></div></fieldset>
            <label className="aggregate-term-filter"><span>الفصل الدراسي</span><select aria-label="الفصل الدراسي في التقرير" value={reportAcademicTerm} onChange={(event) => setReportAcademicTerm(event.target.value as AcademicTerm)}>{academicTerms.map((term) => <option key={term || "all"} value={term}>{term ? termLabel(term) : "كل الفصول"}</option>)}</select></label>
            {reportHasExtraFilters && <button className="aggregate-filter-clear" type="button" onClick={clearReportFilters}>مسح فلاتر التقرير</button>}
            <p className={`aggregate-filter-summary ${reportHasInvalidDateRange ? "is-error" : ""}`} role="status">{reportFilterDescription}</p>
          </div>
          <div className="aggregate-report-actions"><span><FileText size={17} /> يعرض التقرير {reportRows.length} {reportRows.length === 1 ? "ملفًا" : "ملفات"} من جهاز المدير فقط.</span><div><button type="button" onClick={printAggregateReport} disabled={working}><Printer size={16} /> طباعة</button><button type="button" onClick={() => { void exportAggregateExcel(); }} disabled={working}><FileSpreadsheet size={16} /> {working ? "جارٍ التجهيز…" : "تنزيل Excel"}</button><button type="button" onClick={() => { void exportAggregateReport(false); }} disabled={working}><Download size={16} /> تنزيل PDF</button><button type="button" onClick={() => { void exportAggregateReport(true); }} disabled={working}><Send size={16} /> {working ? "جارٍ التجهيز…" : "مشاركة"}</button></div></div>
          <article className="aggregate-report-preview" data-paper-size="a4-landscape" dir="rtl"><header><p>خبير الشواهد للمدير · معاينة A4</p><h3>{reportTitle || "تقرير متابعة إنجازات المعلمين"}</h3><span>{reportPeriodDisplay} · أُعد محليًا على جهاز المدير</span></header><div className="aggregate-preview-stats"><div><small>إجمالي الملفات</small><strong>{reportStats.total}</strong></div><div><small>تمت المراجعة</small><strong>{reportStats.reviewed}</strong></div><div><small>يحتاج متابعة</small><strong>{reportStats.followUp}</strong></div><div><small>نسبة الإنجاز</small><strong>{reportStats.completion}%</strong></div></div><div className="aggregate-preview-table"><table><thead><tr><th>المعلم/ة</th><th>الفصل الدراسي</th><th>حالة المراجعة</th><th>التقدير</th><th>تاريخ الاستيراد</th></tr></thead><tbody>{reportRows.length ? reportRows.map((item) => <tr key={item.id}><td>{item.teacherName}</td><td>{termLabel(item.academicTerm)}</td><td>{reviewLabels[item.reviewStatus]}</td><td>{item.reviewLevel || "لم يحدد"}</td><td>{formatDate(item.importedAt)}</td></tr>) : <tr><td colSpan={5}>لا توجد ملفات ضمن هذا النطاق.</td></tr>}</tbody></table></div><footer>أعده: {directorName || "مدير/ة المدرسة"} · {formatDate(new Date().toISOString())}</footer></article>
        </section>}
        <div className={`director-layout ${activeView !== "inbox" ? "is-hidden" : ""}`}>
          {selected?.reviewStatus === "follow_up" && <section className="whatsapp-follow-up" aria-label="رسالة واتساب للمتابعة"><div className="whatsapp-follow-up-heading"><span><MessageCircle size={19} /></span><div><strong>رسالة متابعة للمعلم</strong><small>تُفتح الرسالة في واتساب للمراجعة قبل الإرسال، ولا تُرسل تلقائيًا.</small></div></div><div className="whatsapp-follow-up-fields"><label><span>رقم واتساب المعلم</span><input type="tel" inputMode="tel" dir="ltr" value={selected.whatsappNumber || ""} onChange={(event) => setSubmissions((items) => items.map((item) => item.id === selected.id ? { ...item, whatsappNumber: event.target.value } : item))} onBlur={(event) => { void updateReview({ whatsappNumber: event.target.value.slice(0, 32) }); }} placeholder="9665XXXXXXXX" /></label><label><span>نص الرسالة</span><textarea value={selected.whatsappMessage || renderWhatsAppTemplate(whatsAppTemplate, selected, directorName)} onChange={(event) => setSubmissions((items) => items.map((item) => item.id === selected.id ? { ...item, whatsappMessage: event.target.value } : item))} onBlur={(event) => { void updateReview({ whatsappMessage: event.target.value.slice(0, 900) }); }} /></label><button type="button" onClick={openWhatsAppFollowUp} disabled={normalizeWhatsAppNumber(selected.whatsappNumber || "").length < 8}><MessageCircle size={17} /> فتح واتساب للمراجعة</button></div></section>}
          <nav className="director-list" aria-label="ملفات الأداء المستوردة">{submissions.length ? submissions.map((submission) => <button key={submission.id} type="button" onClick={() => setSelectedId(submission.id)} className={submission.id === selectedId ? "is-selected" : ""}><span className="submission-file"><FileText size={20} /></span><span><strong>{submission.teacherName}</strong><small>{submission.fileName} · {formatSize(submission.size)}</small></span><i className={`status-dot ${submission.reviewStatus}`} title={reviewLabels[submission.reviewStatus]} /></button>) : <div className="director-empty-list"><FolderOpen size={24} /><span>لا توجد ملفات بعد</span><small>استورد PDF أرسله المعلم للبدء.</small></div>}</nav>
          <section className="director-review">{selected ? <><div className="review-heading"><div><span className={`review-status ${selected.reviewStatus}`}>{reviewLabels[selected.reviewStatus]}</span><h3>{selected.teacherName}</h3><p>استورد في {formatDate(selected.importedAt)}</p></div><button className="director-delete" type="button" onClick={() => { void removeSelected(); }} aria-label="حذف الملف والتقييم"><Trash2 size={17} /></button></div><div className="pdf-preview">{pdfUrl ? <a href={pdfUrl} target="_blank" rel="noreferrer"><FileText size={26} /><span>فتح ملف PDF المستورد</span><small>{selected.fileName}</small></a> : <span>جارٍ تجهيز المعاينة…</span>}</div><div className="review-form"><label><span>حالة المراجعة</span><select value={selected.reviewStatus} onChange={(event) => { void updateReview({ reviewStatus: event.target.value as ReviewStatus }); }}><option value="new">بانتظار المراجعة</option><option value="reviewed">تمت المراجعة</option><option value="follow_up">يحتاج متابعة</option></select></label><label><span>تقدير الإنجاز</span><select value={selected.reviewLevel} onChange={(event) => { void updateReview({ reviewLevel: event.target.value as ReviewLevel }); }}>{reviewLevels.map((level) => <option key={level || "blank"} value={level}>{level || "لم يحدد بعد"}</option>)}</select></label><label><span>الفصل الدراسي</span><select aria-label="الفصل الدراسي للملف" value={selected.academicTerm || ""} onChange={(event) => { void updateReview({ academicTerm: event.target.value as AcademicTerm }); }}>{academicTerms.map((term) => <option key={term || "blank"} value={term}>{term ? termLabel(term) : "لم يحدد بعد"}</option>)}</select></label><label className="review-comment"><span>تعليق مختصر للمعلم</span><textarea value={selected.comment} onChange={(event) => setSubmissions((items) => items.map((item) => item.id === selected.id ? { ...item, comment: event.target.value } : item))} onBlur={(event) => { void updateReview({ comment: event.target.value.slice(0, 600) }); }} placeholder="اكتب ملاحظة واضحة ومهنية…" /></label></div><div className="review-actions"><button type="button" onClick={printReview} disabled={working}><Printer size={17} /> طباعة الملخص</button><button type="button" onClick={() => { void exportReview(false); }} disabled={working}><Download size={17} /> تنزيل الملخص</button><button type="button" onClick={() => { void exportReview(true); }} disabled={working}><Send size={17} /> {working ? "جارٍ التجهيز…" : "مشاركة الملخص"}</button></div></> : <div className="director-empty-review"><Star size={30} /><h3>استورد ملفًا لتبدأ المراجعة</h3><p>يبقى PDF والتقييم محفوظين على جهازك فقط.</p><button type="button" onClick={() => setImportOpen(true)}><Upload size={17} /> استيراد PDF</button></div>}</section>
        </div>
      </section>
    </section>
    {importOpen && <div className="director-modal-backdrop" onMouseDown={() => setImportOpen(false)}><section className="director-import-dialog" role="dialog" aria-modal="true" aria-label="استيراد ملف أداء" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="director-close" onClick={() => setImportOpen(false)} aria-label="إغلاق"><X size={18} /></button><span className="import-mark"><Upload size={23} /></span><h2>استيراد ملف أداء</h2><p>اختر PDF الذي استلمته من المعلم. سيحفظ محليًا على هذا الجهاز فقط.</p><fieldset><label><span>اسم المعلم/المعلمة</span><input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} placeholder="مثال: أمل السهلي" /></label><label><span>الفصل الدراسي للملف</span><select aria-label="الفصل الدراسي عند الاستيراد" value={importAcademicTerm} onChange={(event) => setImportAcademicTerm(event.target.value as AcademicTerm)}>{academicTerms.map((term) => <option key={term || "blank"} value={term}>{term ? termLabel(term) : "لم يحدد بعد"}</option>)}</select></label><input ref={inputRef} type="file" accept="application/pdf,.pdf" className="director-file-input" onChange={(event) => setFile(event.target.files?.[0] || null)} /><button className="director-file-select" type="button" onClick={() => inputRef.current?.click()}><FileText size={18} /> {file ? file.name : "اختر ملف PDF"}</button><button className="director-confirm-import" type="button" disabled={working} onClick={() => { void importPdf(); }}>{working ? "جارٍ الحفظ…" : "حفظ محلي ومتابعة"} <Check size={17} /></button></fieldset></section></div>}
    {whatsAppTemplateOpen && <div className="director-modal-backdrop" onMouseDown={() => setWhatsAppTemplateOpen(false)}><section className="whatsapp-template-dialog" role="dialog" aria-modal="true" aria-label="إعداد قالب واتساب الافتراضي" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="director-close" onClick={() => setWhatsAppTemplateOpen(false)} aria-label="إغلاق"><X size={18} /></button><span className="whatsapp-template-mark"><MessageCircle size={22} /></span><h2>قالب رسالة واتساب</h2><p>يُحفظ على هذا الجهاز فقط، ويملأ رسالة المتابعة الجديدة تلقائيًا. يبقى تعديل كل رسالة متاحًا قبل فتح واتساب.</p><label><span>القالب الافتراضي</span><textarea aria-label="قالب رسالة واتساب الافتراضي" value={whatsAppTemplate} onChange={(event) => setWhatsAppTemplate(event.target.value.slice(0, 900))} /></label><small className="whatsapp-template-variables">المتغيرات المتاحة: <code>{"{{teacherName}}"}</code> <code>{"{{directorName}}"}</code> <code>{"{{comment}}"}</code></small><div className="whatsapp-template-actions"><button type="button" onClick={() => setWhatsAppTemplate(defaultWhatsAppTemplate)}>استعادة النموذج</button><button className="primary-action" type="button" onClick={() => setWhatsAppTemplateOpen(false)}>تم</button></div></section></div>}
    {toast && <div className="director-toast"><Check size={16} /> {toast}</div>}
    <CollaborationInviteDialog open={collaborationOpen} appRole="director" initialSenderName={directorName} onClose={() => setCollaborationOpen(false)} onToast={showToast} />
  </main>;
}
