/**
 * Design reminder — «دفتر منجز»: رحلة معلم دافئة وواضحة، قرار واحد في كل شاشة،
 * خلفية كريمية، حبر أزرق، مريمية للتنظيم، ومشمشي محدود للتقدّم الإيجابي.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Building2,
  Camera,
  Check,
  ChevronDown,
  CloudOff,
  Download,
  FileImage,
  FileDown,
  FileText,
  FolderPlus,
  GripVertical,
  HardDrive,
  ImagePlus,
  Images,
  KeyRound,
  LockKeyhole,
  MoveLeft,
  PackageCheck,
  Palette,
  PenLine,
  Plus,
  Printer,
  Send,
  ScanLine,
  ShieldCheck,
  Share2,
  ShieldAlert,
  Settings2,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { createDefaultPerformanceAreaLabels, createDefaultPerformanceAreas, defaultEvaluationEvidenceTemplate, isDefaultEvaluationEvidenceTemplate, localImageStore, performanceAreas, prototypeStore, reorderPerformanceAreas, type CoverFont, type CoverTemplate, type CoverTeacherAlignment, type CoverTitleSize, type EvidenceItem, type LocalImageMetadata, type PerformanceArea, type PerformanceAreaId, type PerformanceAreaLabels } from "@/lib/evidenceStore";
import { directorStore } from "@/lib/directorStore";
import { appAppearance, appProtection, appThemes, isValidAppPassword, type AppThemeId } from "@/lib/appPreferences";
import { getSuggestedHijriYear } from "@/lib/academicYear";
import { brandEmblemUrl, brandWordmarkUrl } from "@/lib/brand";
import { saudiMinistryOfEducationLogoUrl } from "@/lib/ministryLogo";
import CollaborationInviteDialog from "@/components/CollaborationInviteDialog";
import { inviteFromLocation } from "@/lib/collaborationInvite";

type Step = 0 | 1;
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const steps = [
  { title: "تجميع الحزمة", short: "الحزمة" },
  { title: "المشاركة المقيدة", short: "مشاركة" },
];

const annualEvaluationPeriod = "للعام الدراسي" as const;
const legacyAnnualEvaluationPeriod = "العام الدراسي كاملًا";
const evaluationPeriodOptions = [annualEvaluationPeriod, "الفصل الدراسي الأول", "الفصل الدراسي الثاني"] as const;
type EvaluationPeriod = typeof evaluationPeriodOptions[number];
const defaultEvaluationPeriod: EvaluationPeriod = evaluationPeriodOptions[0];
const periodSelectionStorageKey = "khabir-evidence-period-selection.v1";

const resolveEvaluationPeriod = (value?: string): EvaluationPeriod => {
  const selected = value === legacyAnnualEvaluationPeriod
    ? defaultEvaluationPeriod
    : evaluationPeriodOptions.includes(value as EvaluationPeriod) ? value as EvaluationPeriod : defaultEvaluationPeriod;
  try {
    return selected === "الفصل الدراسي الأول" && !window.localStorage.getItem(periodSelectionStorageKey) ? defaultEvaluationPeriod : selected;
  } catch {
    return selected;
  }
};

const formatCoverAcademicYear = (value: string) => value.trim() ? `العام الدراسي ${value.trim().replace(/^العام الدراسي\s*/, "")}` : "";
const formatCoverTeacherIdentity = (role: string, name: string, showRole: boolean) => name.trim() ? (showRole ? `${role.trim() || "المعلم/ة"}: ${name.trim()}` : name.trim()) : (showRole ? role.trim() : "");

const evidenceTypeLabels: Record<EvidenceItem["type"], string> = {
  certificate: "شهادة أو حضور",
  lesson_plan: "خطة أو ممارسة صفية",
  initiative: "مبادرة مدرسية",
  other: "شاهد آخر",
};

const coverTemplates: Array<{ id: CoverTemplate; label: string; note: string; color: string }> = [
  { id: "formal", label: "رسمي", note: "واضح ومؤسسي", color: "#147C86" },
  { id: "path", label: "عصري", note: "حيوي ومتزن", color: "#2D7DD2" },
  { id: "notebook", label: "بسيط", note: "هادئ ومباشر", color: "#49846E" },
  { id: "gold", label: "ذهبي", note: "رسمي ومميز", color: "#A47A22" },
];

const coverTitleTemplates = ["ملف الأداء المهني", "ملف الإنجاز المهني", "ملف توثيق الشواهد", "سجل الإنجاز والتطوير"];
const coverColors = ["#2D7DD2", "#49846E", "#7A5BA7", "#B66A4D", "#147C86"];
const liteModeStorageKey = "khabir-evidence-lite-mode";
const managerShareStorageKey = "khabir-evidence-manager-share";
const firstSetupStorageKey = "khabir-evidence.first-setup.v1";
type ManagerShareProfile = { name: string; email: string; message: string };

const evidenceIcon = (type: EvidenceItem["type"]) => {
  if (type === "certificate") return PenLine;
  if (type === "lesson_plan") return FileImage;
  if (type === "initiative") return Tag;
  return FileImage;
};

const formatBytes = (size: number) => {
  if (size < 1024) return `${size} بايت`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} كيلوبايت`;
  return `${(size / (1024 * 1024)).toFixed(1)} م.ب`;
};

function StepRail({ current, onStep }: { current: Step; onStep: (step: Step) => void }) {
  return (
    <div className="step-rail" aria-label="تقدم الحزمة">
      {steps.map((step, index) => {
        const completed = index < current;
        const active = index === current;
        return (
          <div className="step-wrap" key={step.title}>
            <button
              className={`step-dot ${active ? "is-active" : ""} ${completed ? "is-complete" : ""}`}
              type="button"
              onClick={() => index <= current && onStep(index as Step)}
              disabled={index > current}
              aria-label={`الخطوة ${index + 1}: ${step.title}`}
            >
              {completed ? <Check size={14} strokeWidth={3} /> : index + 1}
            </button>
            <span className="step-label">{step.short}</span>
            {index !== steps.length - 1 && <span className={`step-line ${index < current ? "is-complete" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

function LocalSavePill({ saveState, online }: { saveState: "ready" | "saved"; online: boolean }) {
  return (
    <span className={`local-pill ${saveState === "saved" ? "is-saved" : ""} ${!online ? "is-offline" : ""}`}>
      {!online ? <WifiOff size={15} /> : saveState === "saved" ? <ShieldCheck size={15} /> : <CloudOff size={15} />}
      {!online ? "دون اتصال" : saveState === "saved" ? "محفوظ" : "محلي"}
    </span>
  );
}

function PhoneHeader({ title, current, onBack, onStep, saveState, online, liteMode, onOpenDisplaySettings, showFirstSetupHint, onSkipFirstSetup }: { title: string; current: Step; onBack?: () => void; onStep: (step: Step) => void; saveState: "ready" | "saved"; online: boolean; liteMode: boolean; onOpenDisplaySettings: () => void; showFirstSetupHint?: boolean; onSkipFirstSetup?: () => void }) {
  return (
    <>
      <div className="phone-topbar">
        <button className="icon-button" type="button" onClick={onBack} aria-label="العودة" disabled={!onBack}>
          <ArrowLeft size={19} />
        </button>
        <span className="header-brand">
          <img className="header-brand-emblem" src={brandEmblemUrl} alt="" aria-hidden="true" />
          <span className="header-brand-copy"><span className="brand-word">خبير الشواهد</span><small>وثّق إنجازاتك</small></span>
        </span>
        <button className={`header-settings-button ${liteMode ? "is-active" : ""} ${showFirstSetupHint ? "is-onboarding-target" : ""}`} type="button" onClick={onOpenDisplaySettings} aria-label="إعدادات التطبيق" title="إعدادات التطبيق"><Settings2 size={18} /></button>
        {showFirstSetupHint && <aside className="first-setup-guide" role="status" aria-label="إرشاد الإعدادات الأولى"><strong>ابدأ بإعداد بياناتك</strong><span>أدخل اسمك واسم المدرسة مرة واحدة ليظهر غلافك جاهزًا.</span><div><button type="button" onClick={onOpenDisplaySettings}>فتح الإعدادات</button><button type="button" onClick={onSkipFirstSetup}>ليس الآن</button></div></aside>}
      </div>
      <div className="screen-heading">
        <div>
          <h2>{title}</h2>
        </div>
        <LocalSavePill saveState={saveState} online={online} />
      </div>
      <StepRail current={current} onStep={onStep} />
    </>
  );
}

export default function Home() {
  const [currentStep, setCurrentStep] = useState<Step>(() => {
    const requestedStep = Number(new URLSearchParams(window.location.search).get("step"));
    return (Number.isInteger(requestedStep) && requestedStep >= 0 && requestedStep <= 1 ? requestedStep : 0) as Step;
  });
  const [savedDraft] = useState(() => prototypeStore.load());
  const [captured, setCaptured] = useState(savedDraft.captured);
  const [saveState, setSaveState] = useState<"ready" | "saved">("ready");
  const [title, setTitle] = useState(savedDraft.title);
  const [category, setCategory] = useState(savedDraft.category);
  const [period, setPeriod] = useState<EvaluationPeriod>(() => resolveEvaluationPeriod(savedDraft.period));
  const [showPeriod, setShowPeriod] = useState(false);
  const [schoolYearEditorOpen, setSchoolYearEditorOpen] = useState(false);
  const [schoolYearDraft, setSchoolYearDraft] = useState("");
  const [reflection, setReflection] = useState(savedDraft.reflection);
  const [includeReflection, setIncludeReflection] = useState(false);
  const [voiceNote, setVoiceNote] = useState(savedDraft.voiceNote);
  const [bundle, setBundle] = useState<EvidenceItem[]>(savedDraft.bundle);
  const [performanceAreaDefinitions, setPerformanceAreaDefinitions] = useState<PerformanceArea[]>(savedDraft.performanceAreas || createDefaultPerformanceAreas());
  const [performanceAreaLabels, setPerformanceAreaLabels] = useState<PerformanceAreaLabels>(savedDraft.performanceAreaLabels || createDefaultPerformanceAreaLabels(savedDraft.performanceAreas || performanceAreas));
  const [performanceAreaEditorOpen, setPerformanceAreaEditorOpen] = useState(false);
  const [newPerformanceAreaName, setNewPerformanceAreaName] = useState("");
  const [draggedPerformanceAreaId, setDraggedPerformanceAreaId] = useState<string | null>(null);
  const [dragOverPerformanceAreaId, setDragOverPerformanceAreaId] = useState<string | null>(null);
  const [openPerformanceAreaId, setOpenPerformanceAreaId] = useState<PerformanceAreaId | null>(null);
  const [editingEvidenceId, setEditingEvidenceId] = useState<string | null>(null);
  const [editingEvidenceTitle, setEditingEvidenceTitle] = useState("");
  const [editingEvidenceType, setEditingEvidenceType] = useState<EvidenceItem["type"]>("other");
  const [editingEvidenceArea, setEditingEvidenceArea] = useState<PerformanceAreaId>("job_duties");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recipient, setRecipient] = useState(savedDraft.recipient);
  const [accessMode, setAccessMode] = useState<"view" | "download">(savedDraft.accessMode);
  const [expiry, setExpiry] = useState(savedDraft.expiry);
  const [schoolName, setSchoolName] = useState(savedDraft.schoolName || "");
  const [schoolStage, setSchoolStage] = useState(savedDraft.schoolStage || "");
  const [principalName, setPrincipalName] = useState(savedDraft.principalName || "");
  const [teacherName, setTeacherName] = useState(savedDraft.teacherName || "");
  const [teacherRole, setTeacherRole] = useState(savedDraft.teacherRole || "");
  const [schoolYear, setSchoolYear] = useState(savedDraft.schoolYear || getSuggestedHijriYear());
  const [coverTemplate, setCoverTemplate] = useState<CoverTemplate>(savedDraft.coverTemplate || "notebook");
  const [coverColor, setCoverColor] = useState(savedDraft.coverColor || "#2D7DD2");
  const [coverNote, setCoverNote] = useState(savedDraft.coverNote || "");
  const [coverTitle, setCoverTitle] = useState(savedDraft.coverTitle || "ملف الأداء المهني");
  const [coverTitleColor, setCoverTitleColor] = useState(savedDraft.coverTitleColor || "#183D5A");
  const [coverFont, setCoverFont] = useState<CoverFont>(savedDraft.coverFont || "modern");
  const [coverTitleSize, setCoverTitleSize] = useState<CoverTitleSize>(savedDraft.coverTitleSize || "standard");
  const [coverTeacherAlignment, setCoverTeacherAlignment] = useState<CoverTeacherAlignment>(savedDraft.coverTeacherAlignment || "center");
  const [showPrincipalName, setShowPrincipalName] = useState(savedDraft.showPrincipalName !== false);
  const [showTeacherRole, setShowTeacherRole] = useState(savedDraft.showTeacherRole !== false);
  const [storageReady, setStorageReady] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [captureImage, setCaptureImage] = useState<{ metadata: LocalImageMetadata; url: string } | null>(null);
  const [captureImages, setCaptureImages] = useState<Array<{ metadata: LocalImageMetadata; url: string }>>([]);
  const [storageSummary, setStorageSummary] = useState({ used: 0, quota: null as number | null, imageCount: 0 });
  const [exporting, setExporting] = useState<"pdf" | "word" | "print" | null>(null);
  const [liteMode, setLiteMode] = useState(() => {
    try { return window.localStorage.getItem(liteModeStorageKey) === "1"; } catch { return false; }
  });
  const [appTheme, setAppTheme] = useState<AppThemeId>(() => appAppearance.getTheme());
  const [appPasswordEnabled, setAppPasswordEnabled] = useState(() => appProtection.hasPassword());
  const [newAppPassword, setNewAppPassword] = useState("");
  const [confirmAppPassword, setConfirmAppPassword] = useState("");
  const [savingAppPassword, setSavingAppPassword] = useState(false);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);
  const [firstSetupOpen, setFirstSetupOpen] = useState(false);
  const [firstSetupAcknowledged, setFirstSetupAcknowledged] = useState(() => {
    try { return window.localStorage.getItem(firstSetupStorageKey) === "done" || window.localStorage.getItem(firstSetupStorageKey) === "skipped"; } catch { return false; }
  });
  const [collaborationOpen, setCollaborationOpen] = useState(() => Boolean(inviteFromLocation()));
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [clearDataConfirmation, setClearDataConfirmation] = useState("");
  const [clearEvidenceOpen, setClearEvidenceOpen] = useState(false);
  const [clearEvidenceConfirmation, setClearEvidenceConfirmation] = useState("");
  const [completeBackupCreated, setCompleteBackupCreated] = useState(false);
  const [managerShareProfile, setManagerShareProfile] = useState<ManagerShareProfile>(() => {
    try {
      const stored = window.localStorage.getItem(managerShareStorageKey);
      const parsed = stored ? JSON.parse(stored) as Partial<ManagerShareProfile> : {};
      return {
        name: typeof parsed.name === "string" ? parsed.name : "",
        email: typeof parsed.email === "string" ? parsed.email : "",
        message: typeof parsed.message === "string" ? parsed.message : "",
      };
    } catch { return { name: "", email: "", message: "" }; }
  });
  const [printSelectionOpen, setPrintSelectionOpen] = useState(false);
  const [printImageSelection, setPrintImageSelection] = useState<string[] | null>(null);
  const [coverSettingsOpen, setCoverSettingsOpen] = useState(false);
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false);
  const [schoolLogo, setSchoolLogo] = useState<{ metadata: LocalImageMetadata; url: string } | null>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const evidenceCameraInputRef = useRef<HTMLInputElement>(null);
  const evidenceFilesInputRef = useRef<HTMLInputElement>(null);
  const evidenceImageTargetRef = useRef<string | null>(null);
  const schoolLogoInputRef = useRef<HTMLInputElement>(null);
  const phoneContentRef = useRef<HTMLDivElement>(null);
  const restoreInProgressRef = useRef(false);
  const [toast, setToast] = useState("");

  const coreProfileComplete = Boolean(teacherName.trim() && schoolName.trim());
  const openDisplaySettings = () => {
    setFirstSetupOpen(false);
    setDisplaySettingsOpen(true);
  };
  const acknowledgeFirstSetup = (state: "done" | "skipped") => {
    try { window.localStorage.setItem(firstSetupStorageKey, state); } catch { /* The coachmark remains session-only when storage is unavailable. */ }
    setFirstSetupAcknowledged(true);
    setFirstSetupOpen(false);
  };
  const finishInitialSettings = () => {
    if (!coreProfileComplete) {
      showToast("أدخل اسم المعلم واسم المدرسة أولًا، أو اختر التجاوز من الإرشاد.");
      return;
    }
    acknowledgeFirstSetup("done");
    setDisplaySettingsOpen(false);
    showToast("تم حفظ بيانات الغلاف على هذا الجهاز");
  };
  const openSchoolYearEditor = () => {
    setSchoolYearDraft(schoolYear);
    setSchoolYearEditorOpen(true);
  };
  const saveSchoolYearFromBundle = () => {
    setSchoolYear(schoolYearDraft.trim() || getSuggestedHijriYear());
    setSchoolYearEditorOpen(false);
    markSaved("تم تحديث العام الدراسي");
  };

  const storagePercent = useMemo(() => storageSummary.quota ? Math.min(100, Math.max(3, (storageSummary.used / storageSummary.quota) * 100)) : 3, [storageSummary]);
  const groupedPerformanceAreas = useMemo(() => performanceAreaDefinitions.map((area) => ({ ...area, label: performanceAreaLabels[area.id] || area.label, items: bundle.filter((item) => item.performanceArea === area.id) })), [bundle, performanceAreaDefinitions, performanceAreaLabels]);
  const defaultEvaluationTemplateApplied = useMemo(() => isDefaultEvaluationEvidenceTemplate(performanceAreaLabels, performanceAreaDefinitions), [performanceAreaDefinitions, performanceAreaLabels]);
  const bundleProgress = useMemo(() => {
    const total = groupedPerformanceAreas.length;
    const completed = groupedPerformanceAreas.filter((area) => area.items.length > 0).length;
    return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
  }, [groupedPerformanceAreas]);
  const evidenceImageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const image of captureImages) counts[image.metadata.evidenceId] = (counts[image.metadata.evidenceId] || 0) + 1;
    return counts;
  }, [captureImages]);
  const selectedPrintImages = useMemo(() => printImageSelection === null ? captureImages : captureImages.filter((image) => printImageSelection.includes(image.metadata.id)), [captureImages, printImageSelection]);

  const portableDraft = useMemo(() => ({
    version: 1 as const,
    captured,
    title,
    category,
    period,
    reflection,
    includeReflection,
    voiceNote,
    bundle,
    performanceAreas: performanceAreaDefinitions,
    performanceAreaLabels,
    recipient,
    accessMode,
    expiry,
    schoolName,
    schoolStage,
    principalName,
    teacherName,
    teacherRole,
    schoolYear,
    coverTemplate,
    coverColor,
    coverNote,
    coverTitle,
    coverTitleColor,
    coverFont,
    coverTitleSize,
    coverTeacherAlignment,
    showPrincipalName,
    showTeacherRole,
    updatedAt: new Date().toISOString(),
  }), [accessMode, bundle, captured, category, coverColor, coverFont, coverNote, coverTeacherAlignment, coverTemplate, coverTitle, coverTitleColor, coverTitleSize, expiry, includeReflection, period, performanceAreaDefinitions, performanceAreaLabels, principalName, recipient, reflection, schoolName, schoolStage, schoolYear, showPrincipalName, showTeacherRole, teacherName, teacherRole, title, voiceNote]);

  useEffect(() => {
    let mounted = true;
    void prototypeStore.loadAsync().then((restored) => {
      if (!mounted) return;
      setCaptured(restored.captured);
      setTitle(restored.title);
      setCategory(restored.category);
      setPeriod(resolveEvaluationPeriod(restored.period));
      setReflection(restored.reflection);
      setIncludeReflection(restored.includeReflection);
      setVoiceNote(restored.voiceNote);
      setBundle(restored.bundle);
      setPerformanceAreaDefinitions(restored.performanceAreas);
      setPerformanceAreaLabels(restored.performanceAreaLabels);
      setRecipient(restored.recipient);
      setAccessMode(restored.accessMode);
      setExpiry(restored.expiry);
      setSchoolName(restored.schoolName || "");
      setSchoolStage(restored.schoolStage || "");
      setPrincipalName(restored.principalName || "");
      setTeacherName(restored.teacherName || "");
      setTeacherRole(restored.teacherRole || "");
      setSchoolYear(restored.schoolYear || getSuggestedHijriYear());
      setCoverTemplate(restored.coverTemplate || "notebook");
      setCoverColor(restored.coverColor || "#2D7DD2");
      setCoverNote(restored.coverNote || "");
      setCoverTitle(restored.coverTitle || "ملف الأداء المهني");
      setCoverTitleColor(restored.coverTitleColor || "#183D5A");
      setCoverFont(restored.coverFont || "modern");
      setCoverTitleSize(restored.coverTitleSize || "standard");
      setCoverTeacherAlignment(restored.coverTeacherAlignment || "center");
      setShowPrincipalName(restored.showPrincipalName !== false);
      setShowTeacherRole(restored.showTeacherRole !== false);
      setSaveState("saved");
      setStorageReady(true);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!storageReady || firstSetupAcknowledged || coreProfileComplete) return;
    setFirstSetupOpen(true);
  }, [coreProfileComplete, firstSetupAcknowledged, storageReady]);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    void Promise.all([
      localImageStore.listImagesForEvidenceIds(bundle.map((item) => item.id)),
      localImageStore.storageSummary(),
    ]).then(([images, summary]) => {
      if (!active) {
        images.forEach((image) => URL.revokeObjectURL(image.url));
        return;
      }
      setCaptureImages(images);
      setCaptureImage(images[0] || null);
      setStorageSummary(summary);
      if (images.length > 0) setCaptured(true);
    });
    return () => { active = false; };
  }, [bundle, storageReady]);

  useEffect(() => () => {
    captureImages.forEach((image) => URL.revokeObjectURL(image.url));
  }, [captureImages]);

  useEffect(() => {
    if (currentStep !== 0 && currentStep !== 1) return;
    let active = true;
    void localImageStore.listEvidenceImages("school-profile").then((images) => {
      const [logo] = images;
      if (!active) {
        images.forEach((image) => URL.revokeObjectURL(image.url));
        return;
      }
      setSchoolLogo(logo || null);
    });
    return () => { active = false; };
  }, [currentStep]);

  useEffect(() => () => {
    if (schoolLogo?.url) URL.revokeObjectURL(schoolLogo.url);
  }, [schoolLogo]);

  useEffect(() => {
    if (!storageReady || restoreInProgressRef.current) return;
    prototypeStore.save(portableDraft);
    setSaveState("saved");
  }, [portableDraft, storageReady]);

  useEffect(() => {
    document.documentElement.classList.toggle("lite-mode", liteMode);
    try {
      if (liteMode) window.localStorage.setItem(liteModeStorageKey, "1");
      else window.localStorage.removeItem(liteModeStorageKey);
    } catch { /* Keep the setting for the current session if storage is unavailable. */ }
  }, [liteMode]);

  useEffect(() => {
    const closeDialogOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (clearDataOpen) return setClearDataOpen(false);
      if (clearEvidenceOpen) return setClearEvidenceOpen(false);
      if (displaySettingsOpen) return setDisplaySettingsOpen(false);
      if (collaborationOpen) return setCollaborationOpen(false);
      if (performanceAreaEditorOpen) return setPerformanceAreaEditorOpen(false);
      if (previewOpen) return setPreviewOpen(false);
      if (printSelectionOpen) return setPrintSelectionOpen(false);
      if (coverSettingsOpen) return setCoverSettingsOpen(false);
      if (coverPreviewOpen) setCoverPreviewOpen(false);
    };
    window.addEventListener("keydown", closeDialogOnEscape);
    return () => window.removeEventListener("keydown", closeDialogOnEscape);
  }, [clearDataOpen, clearEvidenceOpen, collaborationOpen, coverPreviewOpen, coverSettingsOpen, displaySettingsOpen, performanceAreaEditorOpen, previewOpen, printSelectionOpen]);

  useEffect(() => {
    phoneContentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [currentStep]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const markSaved = (message: string) => {
    setSaveState("saved");
    showToast(message);
  };

  const chooseEvaluationPeriod = (option: EvaluationPeriod) => {
    setPeriod(option);
    setShowPeriod(false);
    try { window.localStorage.setItem(periodSelectionStorageKey, "1"); } catch { /* The saved draft still retains the choice. */ }
    markSaved(`تم اعتماد «${option}» لفترة التقويم`);
  };

  const goNext = () => setCurrentStep((step) => Math.min(step + 1, 1) as Step);
  const goBack = () => setCurrentStep((step) => Math.max(step - 1, 0) as Step);

  const beginEvidenceEdit = (item: EvidenceItem) => {
    setOpenPerformanceAreaId(item.performanceArea);
    setEditingEvidenceId(item.id);
    setEditingEvidenceTitle(item.title);
    setEditingEvidenceType(item.type);
    setEditingEvidenceArea(item.performanceArea);
  };

  const saveEvidenceEdit = () => {
    if (!editingEvidenceId) return;
    const nextTitle = editingEvidenceTitle.trim();
    if (!nextTitle) {
      showToast("اكتب اسمًا مختصرًا للشاهد أولًا");
      return;
    }
    setBundle((items) => items.map((item) => item.id === editingEvidenceId ? { ...item, title: nextTitle, type: editingEvidenceType, performanceArea: editingEvidenceArea } : item));
    setEditingEvidenceId(null);
    markSaved("تم تحديث الشاهد داخل الحزمة");
  };

  const removeEvidence = async (item: EvidenceItem) => {
    if (!window.confirm(`حذف «${item.title}» من الحزمة؟`)) return;
    await localImageStore.deleteEvidenceImages(item.id);
    setBundle((items) => items.filter((candidate) => candidate.id !== item.id));
    if (editingEvidenceId === item.id) setEditingEvidenceId(null);
    markSaved("تم حذف الشاهد وصوره من الحزمة");
  };

  const addEvidence = (performanceArea: PerformanceAreaId = "job_duties") => {
    const item: EvidenceItem = { id: crypto.randomUUID?.() || `new-${Date.now()}`, title: "شاهد جديد", type: "other", performanceArea, createdAt: new Date().toISOString() };
    setOpenPerformanceAreaId(performanceArea);
    setBundle((items) => [...items, item]);
    beginEvidenceEdit(item);
    showToast("أضف اسم الشاهد ثم احفظه");
  };

  const createPerformanceAreaId = () => `custom-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

  const addPerformanceArea = () => {
    const label = newPerformanceAreaName.trim();
    if (!label) {
      showToast("اكتب اسم البند الجديد أولًا");
      return;
    }
    if (performanceAreaDefinitions.some((area) => (performanceAreaLabels[area.id] || area.label).trim() === label)) {
      showToast("يوجد بند بالاسم نفسه بالفعل");
      return;
    }
    const area: PerformanceArea = { id: createPerformanceAreaId(), label };
    setPerformanceAreaDefinitions((areas) => [...areas, area]);
    setPerformanceAreaLabels((labels) => ({ ...labels, [area.id]: label }));
    setNewPerformanceAreaName("");
    setOpenPerformanceAreaId(area.id);
    markSaved("تمت إضافة بند أداء جديد إلى الحزمة");
  };

  const removePerformanceArea = (area: PerformanceArea) => {
    if (performanceAreaDefinitions.length <= 1) {
      showToast("يجب الإبقاء على بند أداء واحد على الأقل");
      return;
    }
    const destination = performanceAreaDefinitions.find((candidate) => candidate.id !== area.id);
    if (!destination) return;
    const evidenceCount = bundle.filter((item) => item.performanceArea === area.id).length;
    const destinationLabel = performanceAreaLabels[destination.id] || destination.label;
    const message = evidenceCount
      ? `سيُحذف بند «${performanceAreaLabels[area.id] || area.label}» وتُنقل شواهده (${evidenceCount}) وصورها إلى «${destinationLabel}». لن تُفقد أي بيانات. هل تريد المتابعة؟`
      : `حذف بند «${performanceAreaLabels[area.id] || area.label}» الفارغ من الحزمة؟`;
    if (!window.confirm(message)) return;
    setBundle((items) => items.map((item) => item.performanceArea === area.id ? { ...item, performanceArea: destination.id } : item));
    setPerformanceAreaDefinitions((areas) => areas.filter((candidate) => candidate.id !== area.id));
    setPerformanceAreaLabels((labels) => {
      const { [area.id]: _removed, ...next } = labels;
      return next;
    });
    if (openPerformanceAreaId === area.id) setOpenPerformanceAreaId(destination.id);
    if (editingEvidenceArea === area.id) setEditingEvidenceArea(destination.id);
    if (category === (performanceAreaLabels[area.id] || area.label)) setCategory(destinationLabel);
    markSaved(evidenceCount ? "تم حذف البند ونقل شواهده وصورها بأمان" : "تم حذف بند الأداء الفارغ");
  };

  const movePerformanceArea = (areaId: string, direction: -1 | 1) => {
    setPerformanceAreaDefinitions((areas) => {
      const currentIndex = areas.findIndex((area) => area.id === areaId);
      const target = areas[currentIndex + direction];
      return target ? reorderPerformanceAreas(areas, areaId, target.id) : areas;
    });
  };

  const restoreDefaultPerformanceAreaOrder = () => {
    setPerformanceAreaDefinitions((areas) => {
      const existing = new Map(areas.map((area) => [area.id, area]));
      const defaultAreas = performanceAreas.flatMap((area) => existing.get(area.id) ? [existing.get(area.id)!] : []);
      const customAreas = areas.filter((area) => !performanceAreas.some((defaultArea) => defaultArea.id === area.id));
      return [...defaultAreas, ...customAreas];
    });
    markSaved("استُعيد ترتيب بنود الأداء الافتراضي");
  };

  const saveCapturedEvidenceClassification = () => {
    const selectedArea = performanceAreaDefinitions.find((area) => (performanceAreaLabels[area.id] || area.label) === category)?.id || performanceAreaDefinitions[0]?.id || "job_duties";
    setBundle((items) => items.some((item) => item.id === "workshop")
      ? items.map((item) => item.id === "workshop" ? { ...item, title: title.trim() || "شاهد جديد", type: "certificate", performanceArea: selectedArea } : item)
      : [{ id: crypto.randomUUID?.() || `captured-${Date.now()}`, title: title.trim() || "شاهد جديد", type: "certificate", performanceArea: selectedArea, createdAt: new Date().toISOString() }, ...items]);
    markSaved("تم حفظ الشاهد داخل بند الأداء المختار");
    goNext();
  };

  const savePerformanceAreaNames = () => {
    const nextAreas = performanceAreaDefinitions.map((area) => ({ ...area, label: performanceAreaLabels[area.id]?.trim() || area.label }));
    const names = createDefaultPerformanceAreaLabels(nextAreas);
    const activeArea = performanceAreaDefinitions.find((area) => (performanceAreaLabels[area.id] || area.label) === category)?.id;
    setPerformanceAreaDefinitions(nextAreas);
    setPerformanceAreaLabels(names);
    if (activeArea) setCategory(names[activeArea]);
    setPerformanceAreaEditorOpen(false);
    markSaved("تم حفظ أسماء بنود الأداء على هذا الجهاز");
  };

  const restoreDefaultPerformanceAreaNames = () => {
    const defaultLabels = createDefaultPerformanceAreaLabels();
    const nextAreas = performanceAreaDefinitions.map((area) => ({ ...area, label: defaultLabels[area.id] || performanceAreaLabels[area.id] || area.label }));
    const defaults = createDefaultPerformanceAreaLabels(nextAreas);
    const activeArea = performanceAreaDefinitions.find((area) => (performanceAreaLabels[area.id] || area.label) === category)?.id;
    setPerformanceAreaDefinitions(nextAreas);
    setPerformanceAreaLabels(defaults);
    if (activeArea) setCategory(defaults[activeArea]);
    markSaved("استُعيدت أسماء بنود الأداء الافتراضية");
  };

  const applyDefaultEvaluationEvidenceTemplate = () => {
    if (!defaultEvaluationTemplateApplied && !window.confirm("سيُعاد ضبط أسماء البنود إلى قالب شواهد التقييم الافتراضية. لن تُحذف أي شواهد محفوظة. هل تريد المتابعة؟")) return;
    const customAreas = performanceAreaDefinitions.filter((area) => !performanceAreas.some((defaultArea) => defaultArea.id === area.id));
    const nextAreas = [...createDefaultPerformanceAreas(), ...customAreas.map((area) => ({ ...area, label: performanceAreaLabels[area.id] || area.label }))];
    const defaults = createDefaultPerformanceAreaLabels(nextAreas);
    const activeArea = performanceAreaDefinitions.find((area) => (performanceAreaLabels[area.id] || area.label) === category)?.id;
    setPerformanceAreaDefinitions(nextAreas);
    setPerformanceAreaLabels(defaults);
    if (activeArea) setCategory(defaults[activeArea]);
    markSaved("تم تطبيق قالب شواهد التقييم الافتراضية دون حذف شواهدك");
  };

  const restoreBackup = async (file?: File) => {
    if (!file) return;
    try {
      restoreInProgressRef.current = true;
      const password = window.prompt("إذا كانت النسخة مشفرة، أدخل كلمة المرور. اترك الحقل فارغًا للنسخة العادية.");
      const imported = await prototypeStore.importComplete(file, password || undefined);
      const restored = imported.draft;
      setStorageReady(false);
      await prototypeStore.saveAsync(restored);
      if (imported.includesImages) await Promise.all([localImageStore.restoreBackupImages(imported.images), directorStore.restoreBackup(imported.directorSubmissions)]);
      setCaptured(restored.captured);
      setTitle(restored.title);
      setCategory(restored.category);
      setPeriod(resolveEvaluationPeriod(restored.period));
      setReflection(restored.reflection);
      setIncludeReflection(restored.includeReflection);
      setVoiceNote(restored.voiceNote);
      setBundle(restored.bundle);
      setPerformanceAreaDefinitions(restored.performanceAreas);
      setPerformanceAreaLabels(restored.performanceAreaLabels);
      setRecipient(restored.recipient);
      setAccessMode(restored.accessMode);
      setExpiry(restored.expiry);
      setSchoolName(restored.schoolName || "");
      setSchoolStage(restored.schoolStage || "");
      setPrincipalName(restored.principalName || "");
      setTeacherName(restored.teacherName || "");
      setTeacherRole(restored.teacherRole || "");
      setSchoolYear(restored.schoolYear || getSuggestedHijriYear());
      setCoverTemplate(restored.coverTemplate || "notebook");
      setCoverColor(restored.coverColor || "#2D7DD2");
      setCoverNote(restored.coverNote || "");
      setCoverTitle(restored.coverTitle || "ملف الأداء المهني");
      setCoverTitleColor(restored.coverTitleColor || "#183D5A");
      setCoverFont(restored.coverFont || "modern");
      setCoverTitleSize(restored.coverTitleSize || "standard");
      setCoverTeacherAlignment(restored.coverTeacherAlignment || "center");
      setShowPrincipalName(restored.showPrincipalName !== false);
      setShowTeacherRole(restored.showTeacherRole !== false);
      if (imported.includesImages) {
        await Promise.all([refreshCaptureMedia(), refreshSchoolLogo()]);
        markSaved(`تمت استعادة النسخة الشاملة مع ${imported.images.length} صور محلية`);
      } else markSaved("تمت استعادة النسخة الاحتياطية دون صور لأنها نسخة قديمة");
      window.location.reload();
    } catch {
      showToast("تعذر استيراد هذا الملف");
    }
  };

  const exportCompleteBackup = async () => {
    const password = window.prompt("عيّن كلمة مرور للنسخة الشاملة. احتفظ بها؛ لا يمكن استعادة ملفك وصوره دونها.");
    if (!password) {
      showToast("لم يتم إنشاء النسخة الشاملة");
      return;
    }
    try {
      const { blob, imageCount } = await prototypeStore.createCompleteEncryptedBackup(portableDraft, password, await directorStore.exportBackup());
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "khabir-alshawahid-complete-backup.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setCompleteBackupCreated(true);
      showToast(`تم تنزيل نسخة شاملة مشفرة: ${imageCount} صور · ${formatBytes(blob.size)}`);
    } catch {
      showToast("تعذر إنشاء النسخة الشاملة");
    }
  };

  const saveEncryptedBackupToCloud = async (service: "Google Drive" | "OneDrive") => {
    const password = window.prompt("عيّن كلمة مرور للنسخة الشاملة. احتفظ بها؛ لا يمكن استعادة ملفك وصوره دونها.");
    if (!password) {
      showToast("لم يتم إنشاء النسخة الشاملة");
      return;
    }
    try {
      const { blob, imageCount } = await prototypeStore.createCompleteEncryptedBackup(portableDraft, password, await directorStore.exportBackup());
      const filename = "khabir-alshawahid-complete-backup.json";
      const file = new File([blob], filename, { type: "application/json" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `نسخة خبير الشواهد إلى ${service}`, text: `اختر ${service} من تطبيقات جهازك لحفظ النسخة الشاملة المشفرة (${imageCount} صور).`, files: [file] });
        showToast(`اختر ${service} من لوحة المشاركة لحفظ النسخة الشاملة`);
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        showToast(`نُزّلت النسخة الشاملة؛ ارفعها يدويًا إلى ${service}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") showToast("أُلغي اختيار تطبيق الحفظ");
      else showToast("تعذر إنشاء النسخة المشفرة");
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const refreshCaptureMedia = async () => {
    const { images, summary } = await localImageStore.loadEvidenceOverview();
    setCaptureImages(images);
    setCaptureImage(images[0] || null);
    setStorageSummary(summary);
    setCaptured(images.length > 0);
  };

  const saveCaptureImages = async (files?: FileList | File[] | null) => {
    const nextFiles = Array.from(files || []);
    if (nextFiles.length === 0) return;
    try {
      const metadata = await localImageStore.saveEvidenceImages(nextFiles);
      await refreshCaptureMedia();
      const compressed = metadata.filter((image) => image.compressed).length;
      markSaved(`تم حفظ ${metadata.length} صورة محليًا${compressed ? ` وضُغط ${compressed} منها` : ""}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر حفظ الصورة على الجهاز");
    }
  };

  const refreshBundleMedia = async (evidenceIds = bundle.map((item) => item.id)) => {
    const [images, summary] = await Promise.all([
      localImageStore.listImagesForEvidenceIds(evidenceIds),
      localImageStore.storageSummary(),
    ]);
    setCaptureImages(images);
    setCaptureImage(images[0] || null);
    setStorageSummary(summary);
  };

  const openEvidenceImagePicker = (evidenceId: string, source: "camera" | "files") => {
    evidenceImageTargetRef.current = evidenceId;
    (source === "camera" ? evidenceCameraInputRef : evidenceFilesInputRef).current?.click();
  };

  const saveImagesForSelectedEvidence = async (files?: FileList | File[] | null) => {
    const evidenceId = evidenceImageTargetRef.current;
    const nextFiles = Array.from(files || []);
    if (!evidenceId || nextFiles.length === 0) return;
    try {
      const metadata = await localImageStore.saveEvidenceImages(nextFiles, evidenceId);
      await refreshBundleMedia([...bundle.map((item) => item.id), evidenceId]);
      const compressed = metadata.filter((image) => image.compressed).length;
      markSaved(`أُضيفت ${metadata.length} صورة إلى الشاهد${compressed ? ` وضُغط ${compressed} منها` : ""}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر حفظ الصورة داخل الشاهد");
    }
  };

  const deleteCaptureImage = async (id: string) => {
    await localImageStore.deleteImage(id);
    await refreshCaptureMedia();
    markSaved("تم حذف الصورة من هذا الجهاز");
  };

  const refreshSchoolLogo = async () => {
    const [logo] = await localImageStore.listEvidenceImages("school-profile");
    setSchoolLogo(logo || null);
  };

  const saveSchoolLogo = async (file?: File) => {
    if (!file) return;
    try {
      await localImageStore.deleteEvidenceImages("school-profile");
      await localImageStore.saveEvidenceImages([file], "school-profile");
      await refreshSchoolLogo();
      markSaved("تم حفظ شعار المدرسة محليًا");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر حفظ الشعار على الجهاز");
    }
  };

  const deleteSchoolLogo = async () => {
    await localImageStore.deleteEvidenceImages("school-profile");
    await refreshSchoolLogo();
    markSaved("تم حذف شعار المدرسة من الجهاز");
  };

  const saveCoverPreset = () => {
    prototypeStore.saveCoverPreset(portableDraft);
    markSaved("تم حفظ إعداد الغلاف المفضل على هذا الجهاز");
  };

  const loadCoverPreset = () => {
    const preset = prototypeStore.loadCoverPreset();
    if (!preset) {
      showToast("لا يوجد إعداد غلاف محفوظ بعد");
      return;
    }
    setSchoolName(preset.schoolName);
    setSchoolStage(preset.schoolStage);
    setPrincipalName(preset.principalName);
    setTeacherName(preset.teacherName);
    setTeacherRole(preset.teacherRole);
    setSchoolYear(preset.schoolYear || getSuggestedHijriYear());
    setCoverTemplate(preset.coverTemplate);
    setCoverColor(preset.coverColor);
    setCoverNote(preset.coverNote);
    setCoverTitle(preset.coverTitle);
    setCoverTitleColor(preset.coverTitleColor);
    setCoverFont(preset.coverFont);
    setCoverTitleSize(preset.coverTitleSize);
    setCoverTeacherAlignment(preset.coverTeacherAlignment);
    setShowPrincipalName(preset.showPrincipalName);
    setShowTeacherRole(preset.showTeacherRole);
    markSaved("تمت استعادة إعداد الغلاف المفضل");
  };

  const clearAllLocalData = async () => {
    if (clearDataConfirmation.trim() !== "مسح") return;
    try {
      await Promise.all([prototypeStore.clearAll(), directorStore.clearAll()]);
      try {
        [liteModeStorageKey, managerShareStorageKey, periodSelectionStorageKey, firstSetupStorageKey, "khabir-director-name", "khabir-director-academic-year", "khabir-director-whatsapp-template", "khabir-collaboration-contacts.v1"].forEach((key) => window.localStorage.removeItem(key));
        appAppearance.clearTheme();
        appProtection.clearPassword();
      } catch { /* IndexedDB data has already been cleared; reload still returns a fresh local draft. */ }
      document.documentElement.classList.remove("lite-mode");
      setClearDataOpen(false);
      setClearDataConfirmation("");
      window.location.replace("/");
    } catch {
      showToast("تعذر مسح جميع البيانات؛ أعد المحاولة من الجهاز نفسه");
    }
  };

  const clearEvidenceAndImages = async () => {
    if (clearEvidenceConfirmation.trim() !== "حذف") return;
    try {
      await prototypeStore.clearEvidenceImages();
      captureImages.forEach((image) => URL.revokeObjectURL(image.url));
      setCaptureImages([]);
      setCaptureImage(null);
      setBundle([]);
      setCaptured(false);
      setOpenPerformanceAreaId(null);
      setEditingEvidenceId(null);
      setStorageSummary(await localImageStore.storageSummary());
      setClearEvidenceOpen(false);
      setClearEvidenceConfirmation("");
      markSaved("تم مسح الشواهد وصورها فقط؛ بقيت بيانات المدرسة وإعداداتك محفوظة");
    } catch {
      showToast("تعذر مسح الشواهد والصور؛ أعد المحاولة.");
    }
  };

  const selectAppTheme = (theme: AppThemeId) => {
    appAppearance.setTheme(theme);
    setAppTheme(theme);
    showToast(`تم تطبيق لون «${appThemes.find((option) => option.id === theme)?.label || "الواجهة"}» محليًا`);
  };

  const saveAppPassword = async () => {
    if (!isValidAppPassword(newAppPassword)) return showToast("استخدم كلمة مرور من 6 أحرف على الأقل");
    if (newAppPassword !== confirmAppPassword) return showToast("كلمتا المرور غير متطابقتين");
    setSavingAppPassword(true);
    try {
      await appProtection.setPassword(newAppPassword);
      setAppPasswordEnabled(true);
      setNewAppPassword("");
      setConfirmAppPassword("");
      showToast("تم تفعيل كلمة المرور محليًا؛ يمكنك قفل التطبيق الآن أو عند فتحه لاحقًا");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "تعذر حفظ كلمة المرور على هذا الجهاز");
    } finally {
      setSavingAppPassword(false);
    }
  };

  const removeAppPassword = () => {
    if (!window.confirm("إزالة كلمة مرور التطبيق من هذا الجهاز؟")) return;
    appProtection.clearPassword();
    setAppPasswordEnabled(false);
    setNewAppPassword("");
    setConfirmAppPassword("");
    showToast("أُزيلت كلمة المرور من هذا الجهاز");
  };

  const getPortfolioData = async (imageIds?: string[], performanceAreaId?: string) => {
    const selectedArea = performanceAreaId ? performanceAreaDefinitions.find((area) => area.id === performanceAreaId) : undefined;
    const selectedAreas = selectedArea ? [selectedArea] : performanceAreaDefinitions;
    const selectedEvidence = performanceAreaId ? bundle.filter((item) => item.performanceArea === performanceAreaId) : bundle;
    const selectedEvidenceIds = new Set(selectedEvidence.map((item) => item.id));
    const selectedAreaLabel = selectedArea ? performanceAreaLabels[selectedArea.id] || selectedArea.label : "";
    const acceptedImageIds = imageIds ? new Set(imageIds) : null;
    const selectedImages = captureImages.filter((image) => selectedEvidenceIds.has(image.metadata.evidenceId) && (!acceptedImageIds || acceptedImageIds.has(image.metadata.id)));
    const authorityLogo = await fetch(saudiMinistryOfEducationLogoUrl).then((response) => response.ok ? response.blob() : null).catch(() => null);
    return {
    title: selectedAreaLabel ? `ملف ${selectedAreaLabel}` : title,
    period,
    category: selectedAreaLabel || category,
    reflection,
    includeReflection,
    performanceAreas: selectedAreas.map((area) => ({ id: area.id, label: performanceAreaLabels[area.id] || area.label })),
    evidenceItems: selectedEvidence.map(({ id, title: evidenceTitle, type, performanceArea }) => ({ id, title: evidenceTitle, type: evidenceTypeLabels[type], performanceArea: performanceAreaLabels[performanceArea] || performanceAreaDefinitions.find((area) => area.id === performanceArea)?.label || "بند أداء" })),
    schoolName,
    schoolStage,
    principalName,
    showPrincipalName,
    teacherName,
    teacherRole,
    showTeacherRole,
    schoolYear,
    coverTemplate,
    coverColor,
    coverNote,
    coverTitle,
    coverTitleColor,
    coverFont,
    coverTitleSize,
    coverTeacherAlignment,
    schoolLogo: await localImageStore.getFirstBlobForEvidence("school-profile"),
    authorityLogo,
    images: (await Promise.all(selectedImages.map(async (image) => {
      const blob = await localImageStore.getBlob(image.metadata.id);
      return blob ? { blob, name: image.metadata.name, evidenceId: image.metadata.evidenceId } : null;
    }))).filter((image): image is { blob: Blob; name: string; evidenceId: string } => image !== null),
    };
  };

  const createExport = async (format: "pdf" | "word", share = false, performanceAreaId?: string) => {
    setExporting(format);
    try {
      const data = await getPortfolioData(undefined, performanceAreaId);
      const { downloadPortfolioBlob, exportPortfolioPdf, exportPortfolioWord, portfolioDownloadName } = await import("@/lib/exportPortfolio");
      const blob = format === "pdf" ? await exportPortfolioPdf(data) : await exportPortfolioWord(data);
      const extension = format === "pdf" ? "pdf" : "docx";
      const selectedArea = performanceAreaId ? performanceAreaDefinitions.find((area) => area.id === performanceAreaId) : undefined;
      const selectedAreaLabel = selectedArea ? performanceAreaLabels[selectedArea.id] || selectedArea.label : "";
      const filename = selectedAreaLabel ? `ملف-${selectedAreaLabel.replace(/[\\/:*?"<>|]/g, "-")}.${extension}` : portfolioDownloadName(extension);
      const file = new File([blob], filename, { type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: "ملف الأداء المهني", text: "ملف الأداء المهني", files: [file] });
        showToast("تم فتح خيارات المشاركة على الجهاز");
      } else {
        downloadPortfolioBlob(blob, filename);
        showToast(`تم تنزيل ${selectedAreaLabel ? `بند «${selectedAreaLabel}»` : "الملف"} بصيغة ${format === "pdf" ? "PDF" : "Word"} محليًا`);
      }
    } catch {
      showToast("تعذر إنشاء ملف التصدير");
    } finally {
      setExporting(null);
    }
  };

  const openDirectPrint = async () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      showToast("اسمح بفتح نافذة الطباعة من المتصفح ثم حاول مرة أخرى");
      return;
    }
    setExporting("print");
    try {
      const data = await getPortfolioData(selectedPrintImages.map((image) => image.metadata.id));
      const { openPortfolioPrintDialog } = await import("@/lib/printPortfolio");
      await openPortfolioPrintDialog(printWindow, data);
      showToast("فُتحت واجهة الطباعة؛ اختر الطابعة أو حفظ PDF");
    } catch {
      printWindow.close();
      showToast("تعذر تجهيز مستند الطباعة");
    } finally {
      setExporting(null);
    }
  };

  const togglePrintImage = (imageId: string) => {
    setPrintImageSelection((selection) => {
      const current = selection === null ? captureImages.map((image) => image.metadata.id) : selection;
      return current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId];
    });
  };

  const sharePrintFile = async () => {
    setExporting("print");
    try {
      const data = await getPortfolioData(selectedPrintImages.map((image) => image.metadata.id));
      const { downloadPortfolioBlob, exportPortfolioPdf, portfolioDownloadName } = await import("@/lib/exportPortfolio");
      const blob = await exportPortfolioPdf(data);
      const file = new File([blob], portfolioDownloadName("pdf"), { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: "ملف الطباعة", text: `ملف الأداء المهني — ${selectedPrintImages.length} صور مختارة`, files: [file] });
        showToast("فُتحت تطبيقات الجهاز؛ اختر تطبيق الطباعة المناسب");
      } else {
        downloadPortfolioBlob(blob, portfolioDownloadName("pdf"));
        showToast("نُزّل ملف الطباعة؛ أرسله من تطبيق الملفات إلى الطابعة");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") showToast("أُلغي إرسال ملف الطباعة");
      else showToast("تعذر تجهيز ملف الطباعة للمشاركة");
    } finally {
      setExporting(null);
    }
  };

  const shareToManager = async () => {
    setExporting("pdf");
    try {
      const data = await getPortfolioData();
      const { downloadPortfolioBlob, exportPortfolioPdf, portfolioDownloadName } = await import("@/lib/exportPortfolio");
      const blob = await exportPortfolioPdf(data);
      const filename = portfolioDownloadName("pdf");
      const file = new File([blob], filename, { type: "application/pdf" });
      const recipientLine = managerShareProfile.name ? `إلى: ${managerShareProfile.name}` : "إلى: مدير/ة المدرسة";
      const emailLine = managerShareProfile.email ? `البريد المتفق عليه: ${managerShareProfile.email}` : "";
      const message = [managerShareProfile.message || "أرفق ملف الأداء المهني للمراجعة.", recipientLine, emailLine].filter(Boolean).join("\n");
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: "ملف الأداء المهني", text: message, files: [file] });
        showToast("اختر تطبيق المشاركة والمستلم من جهازك");
      } else {
        downloadPortfolioBlob(blob, filename);
        showToast("نُزّل PDF محليًا؛ أرفقه في البريد أو التطبيق الذي تختاره");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") showToast("أُلغي إرسال الملف");
      else showToast("تعذر تجهيز ملف المشاركة");
    } finally {
      setExporting(null);
    }
  };

  return (
    <main className={`prototype-page ${liteMode ? "is-lite-mode" : ""}`} dir="rtl">
      <div className="ambient-orbit orbit-one" />
      <div className="ambient-orbit orbit-two" />

      <section className="stage-shell" aria-label="تطبيق خبير الشواهد">
        <aside className="experience-panel">
          <div className="panel-header">
            <div className="panel-brand">
              <img className="panel-wordmark" src={brandWordmarkUrl} alt="شعار خبير الشواهد" />
            </div>
            <div className="panel-copy">
              <h1>وثّق إنجازاتك.</h1>
              <p>شواهدك محفوظة بأمان على جهازك، وجاهزة للتصدير عند الحاجة.</p>
            </div>
          </div>

          <div className="journey-list" aria-label="مراحل الرحلة">
            {steps.map((step, index) => (
              <button
                className={`journey-item ${index === currentStep ? "is-current" : ""} ${index < currentStep ? "is-done" : ""}`}
                key={step.title}
                type="button"
                onClick={() => index <= currentStep && setCurrentStep(index as Step)}
                disabled={index > currentStep}
              >
                <span className="journey-number">{index < currentStep ? <Check size={15} /> : `0${index + 1}`}</span>
                <span>{step.title}</span>
                {index === currentStep && <MoveLeft size={16} />}
              </button>
            ))}
          </div>

          <div className="trust-note">
            <LockKeyhole size={18} />
            <div>
              <strong>خصوصيتك ظاهرة</strong>
              <span>تبقى ملفاتك على جهازك ولا تُرفع تلقائيًا.</span>
            </div>
          </div>
          <div className="data-utility">
            <div className="data-utility-copy">{isOnline ? <HardDrive size={17} /> : <WifiOff size={17} />}<span><strong>{isOnline ? "بياناتك محلية" : "وضع دون اتصال"}</strong><small>{storageSummary.imageCount} صور · {formatBytes(storageSummary.used)} محليًا · النسخ إلى Drive يدوي ومشفّر</small></span></div>
            <div className="data-utility-actions">
              <button type="button" onClick={exportCompleteBackup}><Download size={15} /> نسخة شاملة</button>
              <button type="button" onClick={() => { void saveEncryptedBackupToCloud("Google Drive"); }}><Upload size={15} /> حفظ يدوي في Drive</button>
              <label><Upload size={15} /> استيراد<input type="file" accept="application/json,.json" onChange={(event) => restoreBackup(event.target.files?.[0])} /></label>
              {installPrompt && <button type="button" onClick={installApp}><Wifi size={15} /> تثبيت</button>}
            </div>
          </div>
        </aside>

        <section className="phone-stage" aria-label="محاكاة التطبيق">
          <div className="device-chrome">
            <span />
            <span />
            <span />
          </div>
          <div className="phone-frame">
            <div className="phone-content" ref={phoneContentRef}>
              {false && currentStep === 0 && (
                <section className="screen screen-capture">
                  <PhoneHeader title="الالتقاط المحلي" current={0} onStep={setCurrentStep} saveState={saveState} online={isOnline} liteMode={liteMode} onOpenDisplaySettings={openDisplaySettings} showFirstSetupHint={firstSetupOpen} onSkipFirstSetup={() => acknowledgeFirstSetup("skipped")} />
                  <div className="screen-body capture-body">
                    <input ref={captureInputRef} className="local-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { void saveCaptureImages(event.target.files); event.currentTarget.value = ""; }} />
                    <div className={`scanner-surface ${captured ? "has-capture" : ""}`}>
                      <span className="scan-corner corner-tr" />
                      <span className="scan-corner corner-tl" />
                      <span className="scan-corner corner-br" />
                      <span className="scan-corner corner-bl" />
                      {captured ? (
                        <div className="captured-card">
                          {captureImage ? <img className="captured-image-preview" src={captureImage?.url || ""} alt="معاينة الشاهد المحفوظ محليًا" /> : <div className="certificate-seal"><Check size={20} /></div>}
                          <span>شاهد جاهز للتنظيم</span>
                          <small>{captureImage ? `${captureImage?.metadata.name || "شاهد"} · ${captureImages.length} صور` : "شهادة حضور ورشة"}</small>
                        </div>
                      ) : (
                        <div className="scanner-hint">
                          <ScanLine size={44} />
                          <strong>ضع الشاهد داخل الإطار</strong>
                          <span>التقط صورة واضحة، وسنرتبها لاحقًا.</span>
                        </div>
                      )}
                    </div>
                    <p className="local-message"><LockKeyhole size={17} /> سيُحفظ الشاهد على جهازك أولًا</p>
                    <div className="storage-meter" aria-label="مساحة الصور المحلية">
                      <div><span><HardDrive size={15} /> مساحة الصور المحلية</span><small>{storageSummary.imageCount} صور · {formatBytes(storageSummary.used)}{storageSummary.quota ? ` من ${formatBytes(storageSummary.quota ?? 0)}` : ""}</small></div>
                      <span className="storage-track"><i style={{ width: `${storagePercent}%` }} /></span>
                    </div>
                    {captured ? (
                      <>
                        {captureImages.length > 0 && <div className="image-gallery" aria-label="معرض صور الشاهد">{captureImages.map((image, index) => <div className="gallery-thumb" key={image.metadata.id}><img src={image.url} alt={`صورة الشاهد ${index + 1}`} /><button type="button" onClick={() => { void deleteCaptureImage(image.metadata.id); }} aria-label={`حذف الصورة ${index + 1}`}><Trash2 size={13} /></button>{image.metadata.compressed && <span>مضغوطة</span>}</div>)}</div>}
                        <button className="primary-action" type="button" onClick={() => { markSaved("الشاهد محفوظ محليًا"); goNext(); }}>
                          متابعة إلى التصنيف <ArrowRight size={19} />
                        </button>
                      </>
                    ) : (
                      <button className="primary-action" type="button" onClick={() => captureInputRef.current?.click()}>
                        <Camera size={20} /> التقاط الآن
                      </button>
                    )}
                    <label className="secondary-action file-picker">
                      <Images size={19} /> أضف صورًا من الملفات
                      <input type="file" accept="image/*" multiple onChange={(event) => { void saveCaptureImages(event.target.files); event.currentTarget.value = ""; }} />
                    </label>
                  </div>
                </section>
              )}

              {false && currentStep === 1 && (
                <section className="screen screen-classify">
                  <PhoneHeader title="صنّف الشاهد" current={1} onBack={goBack} onStep={setCurrentStep} saveState={saveState} online={isOnline} liteMode={liteMode} onOpenDisplaySettings={openDisplaySettings} showFirstSetupHint={firstSetupOpen} onSkipFirstSetup={() => acknowledgeFirstSetup("skipped")} />
                  <div className="screen-body">
                    <div className="evidence-strip">
                      <div className="mini-certificate"><PenLine size={25} /></div>
                      <div>
                        <strong>{title}</strong>
                        <span>شاهد جديد محفوظ محليًا</span>
                      </div>
                      <Check className="evidence-check" size={19} />
                    </div>
                    <label className="field-card">
                      <span>عنوان الشاهد</span>
                      <input value={title} onChange={(event) => setTitle(event.target.value)} />
                    </label>
                    <label className="field-card performance-area-field">
                      <span>بند الأداء</span>
                      <select aria-label="بند الأداء للشاهد" value={category} onChange={(event) => setCategory(event.target.value)}>
                        {performanceAreaDefinitions.map((area) => <option key={area.id} value={performanceAreaLabels[area.id] || area.label}>{performanceAreaLabels[area.id] || area.label}</option>)}
                      </select>
                      <small>يمكنك إضافة أكثر من شاهد داخل هذا البند من شاشة الحزمة.</small>
                    </label>
                    <div className="field-stack">
                      <button className="field-card select-field" type="button" onClick={() => setShowPeriod((visible) => !visible)}>
                        <span>الفترة</span>
                        <strong>{period}</strong>
                        <ChevronDown size={18} />
                      </button>
                      {showPeriod && (
                        <div className="option-popover">
                          {evaluationPeriodOptions.map((option) => (
                            <button key={option} type="button" onClick={() => chooseEvaluationPeriod(option)} className={period === option ? "is-selected" : ""}>{option}</button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className="primary-action push-bottom" type="button" onClick={saveCapturedEvidenceClassification}>حفظ والمتابعة <ArrowRight size={19} /></button>
                  </div>
                </section>
              )}

              {currentStep === 0 && (
                <section className="screen screen-bundle">
                  <PhoneHeader title="اختر البند وأضف الشاهد" current={0} onStep={setCurrentStep} saveState={saveState} online={isOnline} liteMode={liteMode} onOpenDisplaySettings={openDisplaySettings} showFirstSetupHint={firstSetupOpen} onSkipFirstSetup={() => acknowledgeFirstSetup("skipped")} />
                  <div className="screen-body bundle-body">
                    <input ref={evidenceCameraInputRef} className="local-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => { void saveImagesForSelectedEvidence(event.target.files); event.currentTarget.value = ""; }} />
                    <input ref={evidenceFilesInputRef} className="local-file-input" type="file" accept="image/*" multiple onChange={(event) => { void saveImagesForSelectedEvidence(event.target.files); event.currentTarget.value = ""; }} />
                    <div className="bundle-summary">
                      <div className="bundle-icon"><PackageCheck size={25} /></div>
                      <div>
                        <div className="bundle-summary-title"><strong>{period === defaultEvaluationPeriod ? `ملف الأداء للعام الدراسي${schoolYear ? ` ${schoolYear}` : ""}` : `ملف الأداء — ${period}${schoolYear ? ` · ${schoolYear}` : ""}`}</strong><button className="bundle-year-edit" type="button" onClick={openSchoolYearEditor} aria-label="تعديل العام الدراسي مباشرة" title="تعديل العام الدراسي"><PenLine size={14} /></button></div>
                        <span>{bundle.length} شواهد في ملفك</span>
                        {schoolYearEditorOpen && <form className="bundle-year-editor" onSubmit={(event) => { event.preventDefault(); saveSchoolYearFromBundle(); }}><input aria-label="تحرير العام الدراسي مباشرة" value={schoolYearDraft} onChange={(event) => setSchoolYearDraft(event.target.value)} placeholder="١٤٤٨" autoFocus /><button type="submit">حفظ</button><button type="button" onClick={() => setSchoolYearEditorOpen(false)} aria-label="إلغاء تعديل العام الدراسي">إلغاء</button></form>}
                      </div>
                    </div>
                    <div className="evaluation-period-picker">
                      <button type="button" className="evaluation-period-trigger" onClick={() => setShowPeriod((visible) => !visible)} aria-expanded={showPeriod} aria-controls="evaluation-period-options"><Tag size={16} /><span><small>فترة التقويم</small><strong>{period}</strong></span><ChevronDown size={16} /></button>
                      {showPeriod && <div className="evaluation-period-options" id="evaluation-period-options" role="group" aria-label="اختيار فترة التقويم">{evaluationPeriodOptions.map((option) => <button key={option} type="button" className={period === option ? "is-selected" : ""} onClick={() => chooseEvaluationPeriod(option)}><span>{option}</span>{period === option && <Check size={15} />}</button>)}</div>}
                    </div>
                    <div className="bundle-progress" aria-label="تقدم بنود الأداء">
                      <div><span>تقدّم الحزمة</span><strong>{bundleProgress.completed} من {bundleProgress.total} بنود مكتملة</strong><b>{bundleProgress.percent}%</b></div>
                      <span className="bundle-progress-track" role="progressbar" aria-label="نسبة بنود الأداء المكتملة" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bundleProgress.percent}><i style={{ width: `${bundleProgress.percent}%` }} /></span>
                    </div>
                    <button className="performance-area-manage" type="button" onClick={() => setPerformanceAreaEditorOpen(true)}><PenLine size={16} /> تعديل أسماء بنود الأداء</button>
                    <div className={`evaluation-template-card ${defaultEvaluationTemplateApplied ? "is-applied" : ""}`}>
                      <span className="evaluation-template-mark"><Check size={17} /></span>
                      <span><strong>{defaultEvaluationEvidenceTemplate.label}</strong><small>{defaultEvaluationEvidenceTemplate.note}</small></span>
                      <button type="button" onClick={applyDefaultEvaluationEvidenceTemplate} disabled={defaultEvaluationTemplateApplied}>{defaultEvaluationTemplateApplied ? "مطبق" : "تطبيق"}</button>
                    </div>
                    <p className="performance-area-lead">اختر بند الأداء، ثم أضف اسم الشاهد والتقط كشف المتابعة أو أرفق صوره مباشرة داخله.</p>
                    <div className="performance-area-list" aria-label="بنود الأداء">
                      {groupedPerformanceAreas.map((area) => {
                        const isOpen = openPerformanceAreaId === area.id;
                        return (
                        <section
                          className={`performance-area-card ${area.items.length ? "has-evidence is-complete" : "is-empty"} ${isOpen ? "is-open" : ""} ${draggedPerformanceAreaId === area.id ? "is-dragging" : ""} ${dragOverPerformanceAreaId === area.id && draggedPerformanceAreaId !== area.id ? "is-drag-over" : ""}`}
                          key={area.id}
                          draggable
                          onDragStart={(event) => { setDraggedPerformanceAreaId(area.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", area.id); }}
                          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverPerformanceAreaId(area.id); }}
                          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverPerformanceAreaId(null); }}
                          onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData("text/plain") || draggedPerformanceAreaId; if (sourceId && sourceId !== area.id) { setPerformanceAreaDefinitions((areas) => reorderPerformanceAreas(areas, sourceId, area.id)); markSaved("تم تحديث ترتيب بنود الأداء"); } setDraggedPerformanceAreaId(null); setDragOverPerformanceAreaId(null); }}
                          onDragEnd={() => { setDraggedPerformanceAreaId(null); setDragOverPerformanceAreaId(null); }}
                        >
                          <header>
                            <button className="performance-area-open" type="button" onClick={() => setOpenPerformanceAreaId((open) => open === area.id ? null : area.id)} aria-expanded={isOpen} aria-label={`فتح بند ${area.label}`}>
                              <span className="performance-area-icon"><FolderPlus size={20} /></span>
                              <span><strong>{area.label}</strong><small>{area.items.length ? `مكتمل: ${area.items.length} ${area.items.length === 1 ? "شاهد" : "شواهد"}` : "يحتاج إلى شاهد"}</small></span>
                              <ChevronDown size={17} />
                            </button>
                            <button type="button" onClick={() => addEvidence(area.id)} aria-label={`إضافة شاهد إلى ${area.label}`}><Plus size={17} /> {area.items.length ? "أضف شاهدًا" : "أضف أول شاهد"}</button>
                          </header>
                          {isOpen && <div className="performance-area-details">{area.items.length === 0 && <p className="empty-area-note">هذا البند فارغ ويحتاج شاهدًا واحدًا على الأقل. اضغط «أضف أول شاهد» ثم التقط الصورة أو أرفقها.</p>}
                          <div className="area-export-tools"><span>تصدير هذا البند</span><button type="button" onClick={() => { void createExport("pdf", false, area.id); }} disabled={area.items.length === 0 || exporting !== null} aria-label={`تصدير بند ${area.label} PDF`}><FileDown size={14} /> PDF</button><button type="button" onClick={() => { void createExport("word", false, area.id); }} disabled={area.items.length === 0 || exporting !== null} aria-label={`تصدير بند ${area.label} Word`}><FileText size={14} /> Word</button></div>
                          {area.items.map((item) => {
                            const Icon = evidenceIcon(item.type);
                            const itemIndex = bundle.findIndex((candidate) => candidate.id === item.id);
                            const isEditing = editingEvidenceId === item.id;
                            return (
                              <div className={`bundle-item ${isEditing ? "is-editing" : ""}`} key={item.id}>
                                <span className="complete-check"><Check size={16} /></span>
                                <Icon size={20} />
                                {isEditing ? (
                                  <div className="bundle-inline-editor">
                                    <input aria-label={`عنوان الشاهد ${itemIndex + 1}`} value={editingEvidenceTitle} onChange={(event) => setEditingEvidenceTitle(event.target.value)} placeholder="اسم الشاهد" autoFocus />
                                    <span>
                                      <button type="button" onClick={saveEvidenceEdit} aria-label={`حفظ تعديل الشاهد ${itemIndex + 1}`}><Check size={16} /> حفظ</button>
                                      <button type="button" onClick={() => setEditingEvidenceId(null)} aria-label="إلغاء التعديل">إلغاء</button>
                                    </span>
                                    <div className="evidence-image-actions">
                                      <button type="button" onClick={() => openEvidenceImagePicker(item.id, "camera")} aria-label={`التقاط صورة للشاهد ${item.title}`}><Camera size={14} /> التقاط</button>
                                      <button type="button" onClick={() => openEvidenceImagePicker(item.id, "files")} aria-label={`إضافة صور للشاهد ${item.title}`}><Images size={14} /> أضف صورًا</button>
                                      <small>{evidenceImageCounts[item.id] || 0} صور محفوظة</small>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <span className="bundle-item-copy"><strong>{item.title}</strong><small>{evidenceTypeLabels[item.type]} · {evidenceImageCounts[item.id] || 0} صور</small></span>
                                    <div className="bundle-item-actions">
                                      <button type="button" onClick={() => openEvidenceImagePicker(item.id, "camera")} aria-label={`التقاط صورة للشاهد ${item.title}`}><Camera size={15} /></button>
                                      <button type="button" onClick={() => openEvidenceImagePicker(item.id, "files")} aria-label={`إضافة صور للشاهد ${item.title}`}><Images size={15} /></button>
                                      <button type="button" onClick={() => beginEvidenceEdit(item)} aria-label={`تعديل ${item.title}`}><PenLine size={15} /></button>
                                      <button type="button" onClick={() => removeEvidence(item)} aria-label={`حذف ${item.title}`}><Trash2 size={15} /></button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                          </div>}
                        </section>
                      );})}
                    </div>
                    <button className="primary-action push-bottom" type="button" onClick={() => setPreviewOpen(true)}>معاينة قبل التصدير <ArrowRight size={19} /></button>
                  </div>
                </section>
              )}

              {currentStep === 1 && (
                <section className="screen screen-share">
                  <PhoneHeader title="إرسال نسخة" current={1} onBack={goBack} onStep={setCurrentStep} saveState={saveState} online={isOnline} liteMode={liteMode} onOpenDisplaySettings={openDisplaySettings} showFirstSetupHint={firstSetupOpen} onSkipFirstSetup={() => acknowledgeFirstSetup("skipped")} />
                  <div className="screen-body share-body">
                    <section className="share-cover-summary" aria-labelledby="share-cover-title">
                      <span className="share-cover-icon"><FileImage size={20} /></span>
                      <span><small>معلومات الغلاف</small><strong id="share-cover-title">{coverTitle || "ملف الأداء المهني"}</strong><em>معلم: {teacherName || "أضف الاسم من الإعدادات"}</em></span>
                      <button type="button" onClick={() => setCoverSettingsOpen(true)}>تخصيص الغلاف</button>
                    </section>
                    <section className="share-file-card" aria-labelledby="share-file-title">
                      <div><strong id="share-file-title">ملف جاهز</strong><small>اختر المعاينة أو صيغة المخرج المناسبة.</small></div>
                      <button className="share-preview-action" type="button" onClick={() => setCoverPreviewOpen(true)}><FileImage size={17} /> معاينة الملف</button>
                      <div className="export-actions share-file-actions">
                        <button type="button" onClick={() => { void createExport("pdf"); }} disabled={exporting !== null}>{exporting === "pdf" ? "جارٍ الإنشاء…" : <><FileDown size={17} /> PDF</>}</button>
                        <button type="button" onClick={() => { void createExport("word"); }} disabled={exporting !== null}>{exporting === "word" ? "جارٍ الإنشاء…" : <><FileText size={17} /> Word</>}</button>
                        <button type="button" onClick={() => setPrintSelectionOpen(true)} disabled={exporting !== null}><Printer size={17} /> طباعة</button>
                      </div>
                    </section>
                    <section className="manager-send-card" aria-labelledby="manager-send-title">
                      <div className="manager-send-heading"><span><Send size={19} /></span><div><strong id="manager-send-title">إرسال نسخة للمدير</strong><small>{managerShareProfile.name ? `المستلم: ${managerShareProfile.name}` : "سيفتح جهازك تطبيقات الإرسال لاختيار التطبيق والمستلم."}</small></div></div>
                      <button className="primary-action" type="button" disabled={exporting !== null} onClick={() => { void shareToManager(); }}><Send size={19} /> {exporting === "pdf" ? "جارٍ تجهيز PDF…" : "إرسال نسخة للمدير"}</button>
                    </section>
                    <button className="collaboration-compact-action" type="button" onClick={() => setCollaborationOpen(true)}><UsersRound size={16} /> دعوات التعاون</button>
                    <p className="share-security-note"><LockKeyhole size={16} /> تُنشأ النسخة محليًا على جهازك ولا تُرفع تلقائيًا إلى أي خدمة.</p>
                  </div>
                </section>
              )}
            </div>
            <div className="home-indicator" />
          </div>
        </section>
      </section>

      <footer className="developer-signature" aria-label="توقيع المطور">
        <span className="developer-signature-mark" aria-hidden="true"><i /><i /></span>
        <span className="developer-signature-copy"><small>تطوير</small><strong>عبد الله هوساوي</strong></span>
        <a href="mailto:ab321h@gmail.com" dir="ltr">ab321h@gmail.com</a>
      </footer>

      {toast && <div className="prototype-toast" role="status"><Check size={16} /> {toast}</div>}

      {displaySettingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDisplaySettingsOpen(false)}>
          <section className="display-settings-dialog" role="dialog" aria-modal="true" aria-label="إعدادات التطبيق" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setDisplaySettingsOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="display-settings-heading"><span><Settings2 size={23} /></span><div><p className="eyebrow">إعداداتك محفوظة على هذا الجهاز</p><h3>إعدادات التطبيق</h3></div></div>
            <section className={`app-settings-section cover-profile-settings ${!firstSetupAcknowledged && !coreProfileComplete ? "is-initial-setup" : ""}`} aria-labelledby="cover-profile-title">
              <div className="app-settings-section-heading"><Building2 size={18} /><span><strong id="cover-profile-title">بيانات المعلم والمدرسة</strong><small>تُستخدم تلقائيًا في الغلاف ولا تحتاج إلى إدخالها عند كل تصدير.</small></span></div>
              <div className="cover-form-grid"><label className="field-card"><span>اسم المعلم/المعلمة {!firstSetupAcknowledged && !teacherName.trim() ? <b>مطلوب</b> : null}</span><input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} placeholder="الاسم الكامل" aria-required={!firstSetupAcknowledged} /></label><label className="field-card"><span>الصفة المهنية</span><select value={teacherRole} onChange={(event) => setTeacherRole(event.target.value)}><option value="">بدون صفة</option><option>معلم</option><option>معلمة</option><option>معلم أول</option><option>معلمة أولى</option><option>ممارس/ة تربوي/ة</option></select></label></div>
              <div className="cover-form-grid"><label className="field-card"><span>اسم المدرسة {!firstSetupAcknowledged && !schoolName.trim() ? <b>مطلوب</b> : null}</span><input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} placeholder="مثال: مدرسة الرواد الثانوية" aria-required={!firstSetupAcknowledged} /></label><label className="field-card"><span>المرحلة التعليمية</span><input value={schoolStage} onChange={(event) => setSchoolStage(event.target.value)} placeholder="مثال: المرحلة الثانوية" /></label></div>
              <label className="field-card"><span>مدير/ة المدرسة</span><input value={principalName} onChange={(event) => setPrincipalName(event.target.value)} placeholder="الاسم (اختياري)" /></label>
              <div className="cover-profile-toggles"><button className={`cover-principal-toggle ${showPrincipalName ? "is-active" : ""}`} type="button" role="switch" aria-checked={showPrincipalName} onClick={() => setShowPrincipalName((shown) => !shown)}><span><strong>إظهار اسم مدير/ة المدرسة</strong></span><i /></button><button className={`cover-principal-toggle ${showTeacherRole ? "is-active" : ""}`} type="button" role="switch" aria-checked={showTeacherRole} onClick={() => setShowTeacherRole((shown) => !shown)}><span><strong>إظهار الصفة المهنية قبل الاسم</strong></span><i /></button></div>
            </section>
            <section className="app-settings-section" aria-labelledby="app-theme-title">
              <div className="app-settings-section-heading"><Palette size={18} /><span><strong id="app-theme-title">ألوان الواجهة</strong><small>اختر هوية لونية هادئة تتغير في الشاشات الأساسية.</small></span></div>
              <div className="app-theme-options" role="radiogroup" aria-label="اختيار ألوان واجهة التطبيق">
                {appThemes.map((theme) => <button key={theme.id} type="button" className={appTheme === theme.id ? "is-selected" : ""} aria-pressed={appTheme === theme.id} onClick={() => selectAppTheme(theme.id)}><i data-theme={theme.id} /><span><strong>{theme.label}</strong><small>{theme.note}</small></span><b>{appTheme === theme.id ? <Check size={14} /> : null}</b></button>)}
              </div>
            </section>
            <section className="app-settings-section app-protection-section" aria-labelledby="app-protection-title">
              <div className="app-settings-section-heading"><KeyRound size={18} /><span><strong id="app-protection-title">حماية التطبيق</strong><small>قفل اختياري بكلمة مرور محلية؛ لا يوجد حساب أو استرداد عن بُعد.</small></span></div>
              {appPasswordEnabled ? <div className="app-protection-enabled"><span><LockKeyhole size={17} /><strong>كلمة المرور مفعّلة</strong><small>ستُطلب عند فتح التطبيق من جديد أو بعد اختيار «قفل الآن».</small></span><div><button type="button" onClick={() => appProtection.lockNow()}>قفل الآن</button><button type="button" onClick={removeAppPassword}>إزالة كلمة المرور</button></div></div> : <div className="app-password-fields"><label><span>كلمة مرور جديدة</span><input aria-label="كلمة مرور جديدة للتطبيق" type="password" value={newAppPassword} onChange={(event) => setNewAppPassword(event.target.value)} autoComplete="new-password" placeholder="6 أحرف على الأقل" /></label><label><span>تأكيد كلمة المرور</span><input aria-label="تأكيد كلمة مرور التطبيق" type="password" value={confirmAppPassword} onChange={(event) => setConfirmAppPassword(event.target.value)} autoComplete="new-password" placeholder="أعد كتابتها" /></label><button type="button" onClick={() => { void saveAppPassword(); }} disabled={savingAppPassword}>{savingAppPassword ? "جارٍ الحفظ…" : "تفعيل كلمة المرور"}</button></div>}
            </section>
            <button className={`lite-mode-setting ${liteMode ? "is-active" : ""}`} type="button" role="switch" aria-checked={liteMode} onClick={() => setLiteMode((enabled) => !enabled)}>
              <span className="lite-mode-copy"><strong>الوضع الخفيف</strong><small>{liteMode ? "مفعّل: أوقفنا الزخارف والحركات والظلال الثقيلة" : "عطّل المؤثرات البصرية لتجربة أسرع على الهواتف الأقدم"}</small></span>
              <span className="lite-mode-switch"><i /></span>
            </button>
            <p className="lite-mode-note">لا يغيّر هذا الإعداد بياناتك أو جودة ملفات PDF وWord. يُحفظ اختياره على هذا الجهاز فقط.</p>
            <div className="local-data-danger-zone">
              <span><ShieldAlert size={17} /><strong>إدارة بيانات هذا الجهاز</strong></span>
              <p>امسح الشواهد وصورها وحدها، أو احذف كل البيانات المحلية بما فيها الشعارات والتفضيلات وملفات المدير.</p>
              <div className="local-data-danger-actions"><button className="clear-evidence-only-button" type="button" onClick={() => { setClearEvidenceConfirmation(""); setClearEvidenceOpen(true); }}><Trash2 size={16} /> مسح الشواهد والصور فقط</button><button type="button" onClick={() => { setClearDataConfirmation(""); setCompleteBackupCreated(false); setClearDataOpen(true); }}><ShieldAlert size={16} /> مسح بيانات الجهاز</button></div>
            </div>
            <button className="primary-action" type="button" onClick={!firstSetupAcknowledged && !coreProfileComplete ? finishInitialSettings : () => { if (!firstSetupAcknowledged) acknowledgeFirstSetup("done"); setDisplaySettingsOpen(false); }}>تم <Check size={18} /></button>
          </section>
        </div>
      )}

      <CollaborationInviteDialog open={collaborationOpen} appRole="teacher" initialSenderName={teacherName} initialSchoolName={schoolName} onClose={() => setCollaborationOpen(false)} onToast={showToast} onAccepted={(invite) => {
        if (invite.fromRole === "director" && invite.senderName) setManagerShareProfile((profile) => {
          const next = { ...profile, name: profile.name || invite.senderName };
          try { window.localStorage.setItem(managerShareStorageKey, JSON.stringify(next)); } catch { /* Keep the selected manager for this session if storage is unavailable. */ }
          return next;
        });
      }} />

      {clearDataOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setClearDataOpen(false)}>
          <section className="display-settings-dialog clear-data-dialog" role="dialog" aria-modal="true" aria-label="مسح بيانات هذا الجهاز" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setClearDataOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="display-settings-heading"><span className="clear-data-warning-icon"><ShieldAlert size={23} /></span><div><p className="eyebrow">إجراء نهائي على هذا الجهاز</p><h3>مسح جميع البيانات المحلية</h3></div></div>
            <p className="clear-data-lead">سيُحذف ملف الإنجاز والشواهد والصور والشعارات وإعدادات الغلاف وتفضيلات الإرسال، إضافة إلى ملفات وتقييمات مساحة المدير. لا يمكن التراجع بعد التأكيد.</p>
            <div className={`clear-data-backup-note ${completeBackupCreated ? "is-ready" : ""}`}><ShieldCheck size={16} /><span>{completeBackupCreated ? "أُنشئت نسخة شاملة في هذه الجلسة؛ احتفظ بملفها وكلمة مرورها." : "أنشئ نسخة شاملة مشفرة لملفك وصورك وشعاري الغلاف قبل الحذف."}</span></div>
            <button className="complete-backup-action" type="button" onClick={() => { void exportCompleteBackup(); }}><Download size={17} /> إنشاء نسخة شاملة قبل المسح</button>
            <label className="field-card clear-data-confirmation"><span>اكتب «مسح» للتأكيد</span><input value={clearDataConfirmation} onChange={(event) => setClearDataConfirmation(event.target.value)} placeholder="مسح" autoComplete="off" /></label>
            <button className="clear-data-action" type="button" disabled={clearDataConfirmation.trim() !== "مسح"} onClick={() => { void clearAllLocalData(); }}><Trash2 size={18} /> حذف البيانات نهائيًا</button>
          </section>
        </div>
      )}

      {clearEvidenceOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setClearEvidenceOpen(false)}>
          <section className="display-settings-dialog clear-data-dialog clear-evidence-dialog" role="dialog" aria-modal="true" aria-label="مسح الشواهد والصور فقط" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setClearEvidenceOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="display-settings-heading"><span className="clear-evidence-warning-icon"><Trash2 size={23} /></span><div><p className="eyebrow">إجراء انتقائي على هذا الجهاز</p><h3>مسح الشواهد والصور فقط</h3></div></div>
            <p className="clear-data-lead">سيُحذف كل شاهد مضاف وصوره من الحزمة. ستبقى بيانات المدرسة، شعاري الغلاف، العام الدراسي، ألوان التطبيق، كلمة المرور، وملفات المدير كما هي.</p>
            <div className="clear-evidence-keep-note"><ShieldCheck size={16} /><span>لن يُمسح أي إعداد للمدرسة أو الغلاف؛ سيبقى نموذج بنود الأداء جاهزًا لإضافة شواهد جديدة.</span></div>
            <label className="field-card clear-data-confirmation"><span>اكتب «حذف» للتأكيد</span><input value={clearEvidenceConfirmation} onChange={(event) => setClearEvidenceConfirmation(event.target.value)} placeholder="حذف" autoComplete="off" /></label>
            <button className="clear-data-action clear-evidence-action" type="button" disabled={clearEvidenceConfirmation.trim() !== "حذف"} onClick={() => { void clearEvidenceAndImages(); }}><Trash2 size={18} /> حذف الشواهد والصور</button>
          </section>
        </div>
      )}

      {performanceAreaEditorOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPerformanceAreaEditorOpen(false)}>
          <section className="display-settings-dialog performance-area-editor-dialog" role="dialog" aria-modal="true" aria-label="تعديل أسماء بنود الأداء" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setPerformanceAreaEditorOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="display-settings-heading"><span><FolderPlus size={23} /></span><div><p className="eyebrow">نموذج تقييم مدرستك</p><h3>تعديل أسماء بنود الأداء</h3></div></div>
            <p className="performance-area-editor-lead">غيّر الاسم أو أضف بندًا جديدًا. يمكنك سحب بطاقة البند من الحزمة لتغيير موضعها، أو استخدم سهمي الأعلى والأسفل هنا على الجوال. عند الحذف، تُنقل الشواهد والصور ولا يُحذف أي ملف.</p>
            <div className="performance-area-add"><input aria-label="اسم بند أداء جديد" value={newPerformanceAreaName} onChange={(event) => setNewPerformanceAreaName(event.target.value.slice(0, 80))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addPerformanceArea(); } }} placeholder="مثال: التطوير المهني" /><button type="button" onClick={addPerformanceArea} aria-label="إضافة بند أداء جديد"><Plus size={16} /> أضف بندًا</button></div>
            <div className="performance-area-editor-list">
              {performanceAreaDefinitions.map((area, index) => <div className="performance-area-editor-row" key={area.id}><span className="performance-area-drag-hint" aria-hidden="true"><GripVertical size={17} /></span><label><span>بند الأداء {index + 1}</span><input aria-label={`اسم بند ${area.label}`} value={performanceAreaLabels[area.id] || area.label} onChange={(event) => setPerformanceAreaLabels((labels) => ({ ...labels, [area.id]: event.target.value.slice(0, 80) }))} placeholder={area.label} /></label><div className="performance-area-order-actions" role="group" aria-label={`ترتيب بند ${performanceAreaLabels[area.id] || area.label}`}><button type="button" onClick={() => movePerformanceArea(area.id, -1)} aria-label={`نقل بند ${performanceAreaLabels[area.id] || area.label} إلى الأعلى`} disabled={index === 0}><ArrowUp size={15} /></button><button type="button" onClick={() => movePerformanceArea(area.id, 1)} aria-label={`نقل بند ${performanceAreaLabels[area.id] || area.label} إلى الأسفل`} disabled={index === performanceAreaDefinitions.length - 1}><ArrowDown size={15} /></button></div><button className="performance-area-delete" type="button" onClick={() => removePerformanceArea(area)} aria-label={`حذف بند ${performanceAreaLabels[area.id] || area.label}`} disabled={performanceAreaDefinitions.length <= 1}><Trash2 size={15} /> حذف</button></div>)}
            </div>
            <button className="performance-area-reset" type="button" onClick={restoreDefaultPerformanceAreaOrder}>استعادة الترتيب الافتراضي</button>
            <button className="performance-area-reset" type="button" onClick={restoreDefaultPerformanceAreaNames}>استعادة الأسماء الافتراضية</button>
            <button className="primary-action" type="button" onClick={savePerformanceAreaNames}>حفظ الأسماء <Check size={18} /></button>
          </section>
        </div>
      )}

      {previewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
          <section className="bundle-preview" role="dialog" aria-modal="true" aria-label="معاينة الحزمة" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setPreviewOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="preview-mark"><PackageCheck size={28} /></div>
            <p className="eyebrow">معاينة داخل النموذج</p>
            <h3>حزمتك جاهزة للمراجعة</h3>
            <p>تتضمن الحزمة {bundle.length} شواهد مرتبة وجاهزة للمراجعة.</p>
            <div className="preview-items">{bundle.map((item) => <span key={item.id}><Check size={14} /> {item.title}</span>)}</div>
            <button className="primary-action" type="button" onClick={() => { setPreviewOpen(false); setCurrentStep(1); showToast("أنت الآن في خطوة المشاركة المقيدة"); }}>المتابعة إلى المشاركة <ArrowRight size={19} /></button>
          </section>
        </div>
      )}

      {printSelectionOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPrintSelectionOpen(false)}>
          <section className="print-selection-dialog" role="dialog" aria-modal="true" aria-label="اختيار صور الطباعة" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setPrintSelectionOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="print-selection-heading"><span><Printer size={23} /></span><div><p className="eyebrow">ملفك تحت سيطرتك</p><h3>اختيار صور الطباعة</h3></div></div>
            <p className="print-selection-lead">اختر الصور التي تريد إدراجها فقط. سيبقى الغلاف وملخص الحزمة ضمن الملف في جميع الحالات.</p>
            {captureImages.length > 0 ? (
              <>
                <div className="print-selection-status"><strong>{selectedPrintImages.length} من {captureImages.length} صور محددة</strong><span><button type="button" onClick={() => setPrintImageSelection(null)}>تحديد الكل</button><button type="button" onClick={() => setPrintImageSelection([])}>إلغاء الكل</button></span></div>
                <div className="print-image-picker" aria-label="صور الشاهد للطباعة">
                  {captureImages.map((image, index) => {
                    const selected = selectedPrintImages.some((selectedImage) => selectedImage.metadata.id === image.metadata.id);
                    return <button key={image.metadata.id} type="button" className={selected ? "is-selected" : ""} aria-pressed={selected} onClick={() => togglePrintImage(image.metadata.id)}><span className="print-image-check">{selected && <Check size={14} />}</span><img src={image.url} alt={`صورة الشاهد ${index + 1}`} /><span><strong>صورة الشاهد {index + 1}</strong><small>{image.metadata.name}</small></span></button>;
                  })}
                </div>
              </>
            ) : <div className="print-empty-selection"><FileImage size={21} /><span>لا توجد صور محفوظة بعد؛ سيحتوي الملف على الغلاف والملخص فقط.</span></div>}
            <div className="print-selection-actions"><button className="secondary-action" type="button" disabled={exporting !== null} onClick={() => { setPrintSelectionOpen(false); void openDirectPrint(); }}><Printer size={18} /> فتح الطباعة</button><button className="primary-action" type="button" disabled={exporting !== null} onClick={() => { setPrintSelectionOpen(false); void sharePrintFile(); }}><Share2 size={18} /> إرسال إلى تطبيق الطباعة</button></div>
          </section>
        </div>
      )}

      {coverSettingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCoverSettingsOpen(false)}>
          <section className="cover-settings-dialog" role="dialog" aria-modal="true" aria-label="تخصيص غلاف الملف" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setCoverSettingsOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <div className="cover-settings-heading"><span><Building2 size={23} /></span><div><p className="eyebrow">خطوات قصيرة ونتيجة جاهزة</p><h3>محرر الغلاف السريع</h3></div></div>
            <fieldset className="cover-settings-fields">
            <input ref={schoolLogoInputRef} className="local-file-input" type="file" accept="image/*" onChange={(event) => { void saveSchoolLogo(event.target.files?.[0]); event.currentTarget.value = ""; }} />
            <div className="school-logo-editor">
              <span className="school-logo-preview">{schoolLogo ? <img src={schoolLogo.url} alt="معاينة شعار المدرسة" /> : <ImagePlus size={27} />}</span>
              <div><strong>{schoolLogo ? "شعار المدرسة محفوظ" : "شعار المدرسة اختياري"}</strong><small>يظهر بجانب شعار وزارة التعليم المضمّن تلقائيًا.</small></div>
              <div className="school-logo-actions"><button type="button" onClick={() => schoolLogoInputRef.current?.click()}>{schoolLogo ? "تغيير" : "اختيار"}</button>{schoolLogo && <button type="button" onClick={() => { void deleteSchoolLogo(); }}>حذف</button>}</div>
            </div>
            <label className="field-card"><span>العام الدراسي</span><input value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} placeholder="مثال: ١٤٤٨" /><small>اقتُرح من تقويم جهازك ويمكن تعديله يدويًا.</small></label>
            <div className="cover-profile-summary"><span><strong>اسم المعلم</strong><small>{teacherName || "أضف الاسم مرة واحدة من إعدادات التطبيق"}</small></span><button type="button" onClick={() => { setCoverSettingsOpen(false); setDisplaySettingsOpen(true); }}>تعديل البيانات</button></div>
            <label className="field-card"><span>عنوان الغلاف</span><select aria-label="عنوان الغلاف" value={coverTitleTemplates.includes(coverTitle) ? coverTitle : "custom"} onChange={(event) => setCoverTitle(event.target.value === "custom" ? "" : event.target.value)}>{coverTitleTemplates.map((template) => <option key={template} value={template}>{template}</option>)}<option value="custom">عنوان مخصص</option></select>{!coverTitleTemplates.includes(coverTitle) && <input aria-label="عنوان غلاف مخصص" value={coverTitle} onChange={(event) => setCoverTitle(event.target.value.slice(0, 70))} placeholder="اكتب عنوانًا مخصصًا" />}</label>
            <section className="cover-typography-panel" aria-label="تنسيق عنوان الغلاف وبيانات المعلم">
              <div className="cover-typography-heading"><PenLine size={17} /><span><strong>تنسيق الغلاف</strong><small>اختياري؛ اتركه كما هو للحصول على نتيجة متزنة.</small></span></div>
              <div className="cover-typography-grid"><label><span>نوع الخط</span><select aria-label="نوع خط عنوان الغلاف" value={coverFont} onChange={(event) => setCoverFont(event.target.value as CoverFont)}><option value="modern">عصري واضح</option><option value="classic">كلاسيكي رسمي</option><option value="simple">بسيط عملي</option></select></label><label><span>حجم العنوان</span><select aria-label="حجم عنوان الغلاف" value={coverTitleSize} onChange={(event) => setCoverTitleSize(event.target.value as CoverTitleSize)}><option value="compact">صغير</option><option value="standard">متوسط</option><option value="large">كبير</option></select></label></div>
              <div className="cover-title-colors" aria-label="لون عنوان الغلاف"><label><span>لون العنوان</span><div><input type="color" value={coverTitleColor} onChange={(event) => setCoverTitleColor(event.target.value)} aria-label="لون نص عنوان الغلاف" /><code>{coverTitleColor}</code></div></label></div>
              <div className="cover-teacher-alignment" role="group" aria-label="محاذاة بيانات المعلم"><span>محاذاة بيانات المعلم</span><div>{([['right', 'يمين'], ['center', 'وسط'], ['left', 'يسار']] as const).map(([alignment, label]) => <button key={alignment} type="button" className={coverTeacherAlignment === alignment ? "is-selected" : ""} aria-pressed={coverTeacherAlignment === alignment} onClick={() => setCoverTeacherAlignment(alignment)}>{label}</button>)}</div></div>
            </section>
            <section className="template-picker" aria-label="اختيار تصميم الغلاف"><span className="share-section-title">اختر التصميم</span><div>{coverTemplates.map((template) => <button key={template.id} type="button" className={`template-option ${coverTemplate === template.id ? "is-selected" : ""} ${template.id}`} onClick={() => { setCoverTemplate(template.id); setCoverColor(template.color); }}><i /><strong>{template.label}</strong><small>{template.note}</small></button>)}</div></section>
            <div className="cover-quick-actions"><button className="secondary-action" type="button" onClick={() => { setCoverSettingsOpen(false); setCoverPreviewOpen(true); }}>معاينة الغلاف</button><button className="primary-action" type="button" onClick={() => { setCoverSettingsOpen(false); markSaved("تم حفظ إعداد الغلاف محليًا"); }}>حفظ وتطبيق <Check size={18} /></button></div>
            </fieldset>
          </section>
        </div>
      )}

      {coverPreviewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setCoverPreviewOpen(false)}>
          <section className="cover-preview-dialog" role="dialog" aria-modal="true" aria-label="معاينة الغلاف" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setCoverPreviewOpen(false)} aria-label="إغلاق"><X size={19} /></button>
            <p className="eyebrow">معاينة قبل التصدير</p>
            <div className={`cover-output-preview ${coverTemplate} cover-font-${coverFont} cover-title-${coverTitleSize}`} style={{ "--cover-accent": coverColor, "--cover-teacher-align": coverTeacherAlignment, "--cover-title-color": coverTitleColor } as CSSProperties}>
              <div className="cover-preview-head">
                <div className="cover-preview-school"><strong>{schoolName || "اسم المدرسة"}</strong><small>{[schoolStage, showPrincipalName && principalName ? `مدير/ة المدرسة: ${principalName}` : ""].filter(Boolean).join(" · ") || "المرحلة التعليمية"}</small></div>
                <div className="cover-preview-logos"><img src={saudiMinistryOfEducationLogoUrl} alt="شعار وزارة التعليم" />{schoolLogo && <img src={schoolLogo.url} alt="شعار المدرسة" />}</div>
              </div>
              <div className="cover-preview-center">
                <i />
                <h3>{coverTitle || "ملف الأداء المهني"}</h3>
              </div>
              {(formatCoverTeacherIdentity(teacherRole, teacherName, showTeacherRole) || formatCoverAcademicYear(schoolYear)) && <div className="cover-preview-identity"><strong>{formatCoverTeacherIdentity(teacherRole, teacherName, showTeacherRole)}</strong><span>{formatCoverAcademicYear(schoolYear)}</span></div>}
            </div>
            <div className="cover-preview-actions"><button className="secondary-action" type="button" onClick={() => { setCoverPreviewOpen(false); setCoverSettingsOpen(true); }}>تعديل الغلاف</button><button className="primary-action" type="button" onClick={() => { setCoverPreviewOpen(false); void createExport("pdf"); }}>تصدير PDF <FileDown size={18} /></button></div>
          </section>
        </div>
      )}
    </main>
  );
}
