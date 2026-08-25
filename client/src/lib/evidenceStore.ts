import type { DirectorBackupSubmission } from "./directorStore";

/**
 * Offline-first repository: IndexedDB is the primary local store, while
 * localStorage is a synchronous fallback for small drafts. This module never
 * makes network requests and can be replaced by a consent-based sync adapter.
 */

export type AccessMode = "view" | "download";
export const coverTemplateIds = ["notebook", "formal", "path", "gold"] as const;
export type CoverTemplate = typeof coverTemplateIds[number];
export type CoverFont = "modern" | "classic" | "simple";
export type CoverTitleSize = "compact" | "standard" | "large";
export type CoverTeacherAlignment = "right" | "center" | "left";

export const performanceAreas = [
  { id: "learning_plans", label: "إعداد وتنفيذ خطط التعلم" },
  { id: "classroom_management", label: "الإدارة الصفية" },
  { id: "job_duties", label: "أداء الواجبات الوظيفية" },
  { id: "teaching_strategies", label: "استراتيجيات التدريس" },
  { id: "parent_partnership", label: "التفاعل مع أولياء الأمور" },
  { id: "professional_community", label: "التفاعل مع المجتمع المهني" },
  { id: "learner_results", label: "تحسين نتائج المتعلمين" },
  { id: "results_analysis", label: "تحليل نتائج المتعلمين وتحسين مستوياتهم" },
  { id: "assessment_methods", label: "تنوع أساليب التقويم" },
  { id: "learning_environment", label: "تهيئة البيئة التعليمية" },
  { id: "learning_technology", label: "توظيف تقنيات ووسائل التعلم المناسبة" },
] as const;

export type PerformanceArea = { id: string; label: string };
export type PerformanceAreaId = string;
export type PerformanceAreaLabels = Record<string, string>;

export const createDefaultPerformanceAreas = (): PerformanceArea[] => performanceAreas.map((area) => ({ id: area.id, label: area.label }));

export const createDefaultPerformanceAreaLabels = (areas: readonly PerformanceArea[] = performanceAreas): PerformanceAreaLabels => Object.fromEntries(areas.map((area) => [area.id, area.label]));

export const reorderPerformanceAreas = (areas: readonly PerformanceArea[], sourceId: string, targetId: string): PerformanceArea[] => {
  const sourceIndex = areas.findIndex((area) => area.id === sourceId);
  const targetIndex = areas.findIndex((area) => area.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...areas];
  const next = [...areas];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return next;
  next.splice(targetIndex, 0, source);
  return next;
};

export const defaultEvaluationEvidenceTemplate = {
  id: "default-evaluation",
  label: "شواهد التقييم الافتراضية",
  note: "11 بندًا جاهزًا يمكنك تعديل أسمائها لاحقًا.",
} as const;

export const isDefaultEvaluationEvidenceTemplate = (labels: PerformanceAreaLabels, areas: readonly PerformanceArea[] = performanceAreas) => areas.length === performanceAreas.length
  && performanceAreas.every((area) => labels[area.id] === area.label && areas.some((candidate) => candidate.id === area.id));

export type EvidenceItem = {
  id: string;
  title: string;
  type: "certificate" | "lesson_plan" | "initiative" | "other";
  performanceArea: PerformanceAreaId;
  createdAt: string;
};

export type PrototypeDraft = {
  version: 1;
  captured: boolean;
  title: string;
  category: string;
  period: string;
  reflection: string;
  includeReflection: boolean;
  voiceNote: boolean;
  bundle: EvidenceItem[];
  performanceAreas: PerformanceArea[];
  performanceAreaLabels: PerformanceAreaLabels;
  recipient: string;
  accessMode: AccessMode;
  expiry: string;
  schoolName: string;
  schoolStage: string;
  principalName: string;
  teacherName: string;
  teacherRole: string;
  schoolYear: string;
  coverTemplate: CoverTemplate;
  coverColor: string;
  coverNote: string;
  coverTitle: string;
  coverTitleColor: string;
  coverFont: CoverFont;
  coverTitleSize: CoverTitleSize;
  coverTeacherAlignment: CoverTeacherAlignment;
  showPrincipalName: boolean;
  showTeacherRole: boolean;
  updatedAt: string;
};

export type CoverPreset = Pick<PrototypeDraft, "schoolName" | "schoolStage" | "principalName" | "teacherName" | "teacherRole" | "schoolYear" | "coverTemplate" | "coverColor" | "coverNote" | "coverTitle" | "coverTitleColor" | "coverFont" | "coverTitleSize" | "coverTeacherAlignment" | "showPrincipalName" | "showTeacherRole">;

const STORAGE_KEY = "khabir-alshawahid.prototype.v1";
const COVER_PRESET_KEY = "khabir-alshawahid.cover-preset.v1";
const DATABASE_NAME = "khabir-alshawahid-local";
const DATABASE_VERSION = 2;
const STORE_NAME = "drafts";
const IMAGE_STORE_NAME = "image_assets";
const DRAFT_ID = "current";
let indexedDraftWriteQueue: Promise<void> = Promise.resolve();

type EncryptedBackup = {
  version: 1 | 2;
  encrypted: true;
  salt: string;
  iv: string;
  payload: string;
};

export type LocalImageMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  originalSize: number;
  evidenceId: string;
  order: number;
  compressed: boolean;
  updatedAt: string;
};

type StoredImage = LocalImageMetadata & { blob: Blob };
type BackupImage = LocalImageMetadata & { payload: string };
type CompleteBackupPayload = {
  version: 2;
  kind: "complete";
  exportedAt: string;
  draft: PrototypeDraft;
  images: BackupImage[];
  directorSubmissions: DirectorBackupSubmission[];
};

export type ImportedBackup = {
  draft: PrototypeDraft;
  images: BackupImage[];
  directorSubmissions: DirectorBackupSubmission[];
  includesImages: boolean;
};

export const createDefaultDraft = (): PrototypeDraft => ({
  version: 1,
  captured: false,
  title: "شهادة حضور ورشة",
  category: "استراتيجيات التدريس",
  period: "للعام الدراسي",
  reflection: "",
  includeReflection: false,
  voiceNote: false,
  bundle: [
    { id: "workshop", title: "شهادة حضور ورشة", type: "certificate", performanceArea: "teaching_strategies", createdAt: "2026-08-17T00:00:00.000Z" },
    { id: "lesson", title: "خطة درس مميزة", type: "lesson_plan", performanceArea: "learning_plans", createdAt: "2026-08-17T00:00:00.000Z" },
    { id: "initiative", title: "مبادرة صفية", type: "initiative", performanceArea: "professional_community", createdAt: "2026-08-17T00:00:00.000Z" },
  ],
  performanceAreas: createDefaultPerformanceAreas(),
  performanceAreaLabels: createDefaultPerformanceAreaLabels(),
  recipient: "",
  accessMode: "view",
  expiry: "14 يومًا",
  schoolName: "",
  schoolStage: "",
  principalName: "",
  teacherName: "",
  teacherRole: "",
  schoolYear: "",
  coverTemplate: "notebook",
  coverColor: "#2D7DD2",
  coverNote: "",
  coverTitle: "ملف الأداء المهني",
  coverTitleColor: "#183D5A",
  coverFont: "modern",
  coverTitleSize: "standard",
  coverTeacherAlignment: "center",
  showPrincipalName: true,
  showTeacherRole: true,
  updatedAt: new Date().toISOString(),
});

const isDraft = (value: unknown): value is PrototypeDraft => {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PrototypeDraft>;
  return draft.version === 1 && typeof draft.title === "string" && Array.isArray(draft.bundle);
};

const retiredReflection = ["وثّقت مشاركتي في ورشة تدريبية", "طورت ممارساتي الصفية."].join(" ");
export const removeRetiredReflection = (reflection: string) => reflection.trim() === retiredReflection ? "" : reflection;

const normalizeDraft = (draft: PrototypeDraft): PrototypeDraft => {
  const rawAreas = Array.isArray(draft.performanceAreas) ? draft.performanceAreas : createDefaultPerformanceAreas();
  const knownDefaultLabels = createDefaultPerformanceAreaLabels();
  const seenAreaIds = new Set<string>();
  const normalizedAreas: PerformanceArea[] = [];

  rawAreas.forEach((area) => {
    if (!area || typeof area.id !== "string" || !area.id.trim() || seenAreaIds.has(area.id)) return;
    const id = area.id.trim();
    const storedLabel = draft.performanceAreaLabels?.[id];
    const suppliedLabel = typeof area.label === "string" ? area.label : "";
    const label = storedLabel?.trim() || suppliedLabel.trim() || knownDefaultLabels[id] || "بند أداء";
    seenAreaIds.add(id);
    normalizedAreas.push({ id, label });
  });

  if (!normalizedAreas.length) normalizedAreas.push(...createDefaultPerformanceAreas());

  const performanceAreaLabels = Object.fromEntries(normalizedAreas.map((area) => [area.id, area.label]));
  const reflection = removeRetiredReflection(draft.reflection || "");
  const availableAreaIds = new Set(normalizedAreas.map((area) => area.id));
  const fallbackAreaId = availableAreaIds.has("job_duties") ? "job_duties" : normalizedAreas[0]?.id || "job_duties";
  const fallbackForType = (type: EvidenceItem["type"]) => {
    const suggested = type === "lesson_plan"
      ? "learning_plans"
      : type === "initiative"
        ? "professional_community"
        : type === "certificate"
          ? "teaching_strategies"
          : fallbackAreaId;
    return availableAreaIds.has(suggested) ? suggested : fallbackAreaId;
  };

  return {
    ...draft,
    category: draft.category?.trim() || performanceAreaLabels[fallbackAreaId] || "بند أداء",
    reflection,
    includeReflection: reflection.trim() ? draft.includeReflection : false,
    coverTemplate: draft.coverTemplate === "formal" || draft.coverTemplate === "path" || draft.coverTemplate === "gold" ? draft.coverTemplate : "notebook",
    coverTitle: draft.coverTitle?.trim() || "ملف الأداء المهني",
    coverTitleColor: /^#[0-9a-fA-F]{6}$/.test(draft.coverTitleColor || "") ? draft.coverTitleColor : "#183D5A",
    coverFont: draft.coverFont === "classic" || draft.coverFont === "simple" ? draft.coverFont : "modern",
    coverTitleSize: draft.coverTitleSize === "compact" || draft.coverTitleSize === "large" ? draft.coverTitleSize : "standard",
    coverTeacherAlignment: draft.coverTeacherAlignment === "right" || draft.coverTeacherAlignment === "left" ? draft.coverTeacherAlignment : "center",
    showPrincipalName: draft.showPrincipalName !== false,
    showTeacherRole: draft.showTeacherRole !== false,
    performanceAreas: normalizedAreas,
    performanceAreaLabels,
    bundle: draft.bundle.map((item) => ({
      ...item,
      performanceArea: availableAreaIds.has(item.performanceArea) ? item.performanceArea : fallbackForType(item.type),
    })),
  };
};

const isEncryptedBackup = (value: unknown): value is EncryptedBackup => {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<EncryptedBackup>;
  return (backup.version === 1 || backup.version === 2) && backup.encrypted === true && typeof backup.salt === "string" && typeof backup.iv === "string" && typeof backup.payload === "string";
};

const isBackupImage = (value: unknown): value is BackupImage => {
  if (!value || typeof value !== "object") return false;
  const image = value as Partial<BackupImage>;
  return typeof image.id === "string" && typeof image.name === "string" && typeof image.type === "string" && typeof image.size === "number" && typeof image.originalSize === "number" && typeof image.evidenceId === "string" && typeof image.order === "number" && typeof image.compressed === "boolean" && typeof image.updatedAt === "string" && typeof image.payload === "string";
};

const isCompleteBackupPayload = (value: unknown): value is CompleteBackupPayload => {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<CompleteBackupPayload>;
  return backup.version === 2 && backup.kind === "complete" && Array.isArray(backup.images) && backup.images.every(isBackupImage) && Array.isArray(backup.directorSubmissions) && isDraft(backup.draft);
};

const toBase64 = (data: ArrayBuffer) => {
  const bytes = new Uint8Array(data);
  let text = "";
  bytes.forEach((value) => { text += String.fromCharCode(value); });
  return btoa(text);
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const deriveBackupKey = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

const downloadPayload = (payload: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseDraft = (value: unknown): PrototypeDraft => {
  const candidate = typeof value === "object" && value && "draft" in value ? value.draft : value;
  if (!isDraft(candidate)) throw new Error("ملف النسخة الاحتياطية غير متوافق");
  return candidate;
};

const decryptBackupPayload = async (value: unknown, password?: string): Promise<unknown> => {
  if (!isEncryptedBackup(value)) return value;
  if (!password) throw new Error("كلمة مرور النسخة الاحتياطية مطلوبة");
  const key = await deriveBackupKey(password, fromBase64(value.salt));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(value.iv) }, key, fromBase64(value.payload));
  return JSON.parse(new TextDecoder().decode(decrypted));
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME);
    }
    if (!request.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
      request.result.createObjectStore(IMAGE_STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readIndexedDraft = async (): Promise<PrototypeDraft | null> => {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DRAFT_ID);
      request.onsuccess = () => { database.close(); resolve(isDraft(request.result) ? normalizeDraft(request.result) : null); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    return null;
  }
};

const writeIndexedDraft = async (draft: PrototypeDraft) => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(draft, DRAFT_ID);
      request.onsuccess = () => { database.close(); resolve(); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    // The localStorage fallback has already received the same small draft.
  }
};

const queueIndexedDraftWrite = (draft: PrototypeDraft) => {
  indexedDraftWriteQueue = indexedDraftWriteQueue.catch(() => undefined).then(() => writeIndexedDraft(draft));
  return indexedDraftWriteQueue;
};

const clearIndexedDraft = async () => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(DRAFT_ID);
      request.onsuccess = () => { database.close(); resolve(); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    // Clearing the fallback is still useful even if IndexedDB is unavailable.
  }
};

const clearIndexedAppData = async () => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME, IMAGE_STORE_NAME], "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.objectStore(IMAGE_STORE_NAME).clear();
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
};

const restoreStoredImages = async (images: BackupImage[]) => {
  if (typeof window === "undefined" || !window.indexedDB) throw new Error("IndexedDB غير متاح على هذا الجهاز");
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    store.clear();
    images.forEach(({ payload, ...metadata }) => {
      store.put({ ...metadata, blob: new Blob([fromBase64(payload)], { type: metadata.type }) } satisfies StoredImage, metadata.id);
    });
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
};

const getStoredImage = async (id: string): Promise<StoredImage | null> => {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(IMAGE_STORE_NAME, "readonly").objectStore(IMAGE_STORE_NAME).get(id);
      request.onsuccess = () => { database.close(); resolve(request.result || null); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    return null;
  }
};

const getAllStoredImages = async (): Promise<StoredImage[]> => {
  if (typeof window === "undefined" || !window.indexedDB) return [];
  try {
    const database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(IMAGE_STORE_NAME, "readonly").objectStore(IMAGE_STORE_NAME).getAll();
      request.onsuccess = () => { database.close(); resolve(request.result || []); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    return [];
  }
};

const putStoredImage = async (image: StoredImage) => {
  if (typeof window === "undefined" || !window.indexedDB) throw new Error("IndexedDB غير متاح على هذا الجهاز");
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.usage && estimate.usage + image.size > estimate.quota * 0.9) {
    throw new Error("لا توجد مساحة محلية كافية لحفظ هذه الصورة");
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(IMAGE_STORE_NAME, "readwrite").objectStore(IMAGE_STORE_NAME).put(image, image.id);
    request.onsuccess = () => { database.close(); resolve(); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
};

const deleteStoredImage = async (id: string) => {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(IMAGE_STORE_NAME, "readwrite").objectStore(IMAGE_STORE_NAME).delete(id);
      request.onsuccess = () => { database.close(); resolve(); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  } catch {
    // A failed image delete must not affect the rest of the local draft.
  }
};

const buildImageId = () => `image-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

const readImage = (file: Blob) => new Promise<HTMLImageElement>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
  image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("تعذر قراءة الصورة")); };
  image.src = url;
});

const compressForStorage = async (file: File): Promise<{ blob: Blob; type: string; compressed: boolean }> => {
  const canOptimize = file.type === "image/jpeg" || file.type === "image/webp";
  if (!canOptimize || file.size < 1024 * 1024) return { blob: file, type: file.type, compressed: false };
  try {
    const image = await readImage(file);
    const maximumSide = 2400;
    const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return { blob: file, type: file.type, compressed: false };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const optimized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!optimized || optimized.size >= file.size * 0.97) return { blob: file, type: file.type, compressed: false };
    return { blob: optimized, type: "image/jpeg", compressed: true };
  } catch {
    return { blob: file, type: file.type, compressed: false };
  }
};

export const prototypeStore = {
  load(): PrototypeDraft {
    if (typeof window === "undefined") return createDefaultDraft();
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      return isDraft(parsed) ? normalizeDraft(parsed) : createDefaultDraft();
    } catch {
      return createDefaultDraft();
    }
  },

  async loadAsync(): Promise<PrototypeDraft> {
    const indexedDraft = await readIndexedDraft();
    const localDraft = this.load();
    if (!indexedDraft) return localDraft;
    return new Date(localDraft.updatedAt).getTime() > new Date(indexedDraft.updatedAt).getTime() ? localDraft : indexedDraft;
  },

  save(draft: PrototypeDraft) {
    if (typeof window === "undefined") return;
    const next = { ...draft, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    void queueIndexedDraftWrite(next);
  },

  async saveAsync(draft: PrototypeDraft) {
    if (typeof window === "undefined") return;
    const next = { ...draft, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    await queueIndexedDraftWrite(next);
  },

  clear() {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    void clearIndexedDraft();
    void deleteStoredImage("capture-image");
  },

  async clearEvidenceImages() {
    const protectedEvidenceIds = new Set(["school-profile"]);
    if (typeof window === "undefined") return;

    const indexedDraft = await readIndexedDraft();
    const localDraft = this.load();
    const currentDraft = !indexedDraft
      ? localDraft
      : new Date(localDraft.updatedAt).getTime() > new Date(indexedDraft.updatedAt).getTime() ? localDraft : indexedDraft;

    const clearedDraft: PrototypeDraft = { ...currentDraft, bundle: [], captured: false, updatedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clearedDraft));

    if (!window.indexedDB) return;
    const images = await getAllStoredImages();
    const idsToDelete = images
      .filter((image) => !protectedEvidenceIds.has(image.evidenceId))
      .map((image) => image.id);

    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME, IMAGE_STORE_NAME], "readwrite");
      transaction.objectStore(STORE_NAME).put(clearedDraft, DRAFT_ID);

      const imageStore = transaction.objectStore(IMAGE_STORE_NAME);
      idsToDelete.forEach((id) => imageStore.delete(id));

      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    });
  },
  async clearAll() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(COVER_PRESET_KEY);
    }
    await clearIndexedAppData();
  },

  export(draft: PrototypeDraft) {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), draft }, null, 2);
    downloadPayload(payload, "khabir-alshawahid-backup.json");
  },

  saveCoverPreset(draft: PrototypeDraft) {
    if (typeof window === "undefined") return;
    const preset: CoverPreset = {
      schoolName: draft.schoolName,
      schoolStage: draft.schoolStage,
      principalName: draft.principalName,
      teacherName: draft.teacherName,
      teacherRole: draft.teacherRole,
      schoolYear: draft.schoolYear,
      coverTemplate: draft.coverTemplate,
      coverColor: draft.coverColor,
      coverNote: draft.coverNote,
      coverTitle: draft.coverTitle,
      coverTitleColor: draft.coverTitleColor,
      coverFont: draft.coverFont,
      coverTitleSize: draft.coverTitleSize,
      coverTeacherAlignment: draft.coverTeacherAlignment,
      showPrincipalName: draft.showPrincipalName,
      showTeacherRole: draft.showTeacherRole,
    };
    window.localStorage.setItem(COVER_PRESET_KEY, JSON.stringify(preset));
  },

  loadCoverPreset(): CoverPreset | null {
    if (typeof window === "undefined") return null;
    try {
      const preset = JSON.parse(window.localStorage.getItem(COVER_PRESET_KEY) || "null") as Partial<CoverPreset> | null;
      if (!preset || typeof preset.schoolName !== "string" || typeof preset.coverColor !== "string") return null;
      return {
        schoolName: preset.schoolName,
        schoolStage: preset.schoolStage || "",
        principalName: preset.principalName || "",
        teacherName: preset.teacherName || "",
        teacherRole: preset.teacherRole || "",
        schoolYear: preset.schoolYear || "",
        coverTemplate: preset.coverTemplate || "notebook",
        coverColor: preset.coverColor,
        coverNote: preset.coverNote || "",
        coverTitle: preset.coverTitle || "ملف الأداء المهني",
        coverTitleColor: typeof preset.coverTitleColor === "string" && /^#[0-9a-fA-F]{6}$/.test(preset.coverTitleColor) ? preset.coverTitleColor : "#183D5A",
        coverFont: preset.coverFont === "classic" || preset.coverFont === "simple" ? preset.coverFont : "modern",
        coverTitleSize: preset.coverTitleSize === "compact" || preset.coverTitleSize === "large" ? preset.coverTitleSize : "standard",
        coverTeacherAlignment: preset.coverTeacherAlignment === "right" || preset.coverTeacherAlignment === "left" ? preset.coverTeacherAlignment : "center",
        showPrincipalName: preset.showPrincipalName !== false,
        showTeacherRole: preset.showTeacherRole !== false,
      };
    } catch {
      return null;
    }
  },

  async createEncryptedBackup(draft: PrototypeDraft, password: string): Promise<Blob> {
    if (!password) throw new Error("كلمة المرور مطلوبة");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(password, salt);
    const plainText = new TextEncoder().encode(JSON.stringify({ exportedAt: new Date().toISOString(), draft }));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainText);
    const backup: EncryptedBackup = { version: 1, encrypted: true, salt: toBase64(salt.buffer), iv: toBase64(iv.buffer), payload: toBase64(encrypted) };
    return new Blob([JSON.stringify(backup)], { type: "application/json" });
  },

  async createCompleteEncryptedBackup(draft: PrototypeDraft, password: string, directorSubmissions: DirectorBackupSubmission[] = []): Promise<{ blob: Blob; imageCount: number }> {
    if (!password) throw new Error("كلمة المرور مطلوبة");
    const images = await getAllStoredImages();
    const payload: CompleteBackupPayload = {
      version: 2,
      kind: "complete",
      exportedAt: new Date().toISOString(),
      draft,
      images: await Promise.all(images.map(async ({ blob, ...metadata }) => ({ ...metadata, payload: toBase64(await blob.arrayBuffer()) }))),
      directorSubmissions,
    };
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
    const backup: EncryptedBackup = { version: 2, encrypted: true, salt: toBase64(salt.buffer), iv: toBase64(iv.buffer), payload: toBase64(encrypted) };
    return { blob: new Blob([JSON.stringify(backup)], { type: "application/json" }), imageCount: images.length };
  },

  async exportEncrypted(draft: PrototypeDraft, password: string) {
    const blob = await this.createEncryptedBackup(draft, password);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "khabir-alshawahid-encrypted-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
  },

  async exportCompleteEncrypted(draft: PrototypeDraft, password: string, directorSubmissions: DirectorBackupSubmission[] = []) {
    const { blob, imageCount } = await this.createCompleteEncryptedBackup(draft, password, directorSubmissions);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "khabir-alshawahid-complete-backup.json";
    anchor.click();
    URL.revokeObjectURL(url);
    return imageCount;
  },

  async import(file: File, password?: string): Promise<PrototypeDraft> {
    return (await this.importComplete(file, password)).draft;
  },

  async importComplete(file: File, password?: string): Promise<ImportedBackup> {
    const payload = await decryptBackupPayload(JSON.parse(await file.text()) as unknown, password);
    if (isCompleteBackupPayload(payload)) return { draft: normalizeDraft(payload.draft), images: payload.images, directorSubmissions: payload.directorSubmissions, includesImages: true };
    return { draft: parseDraft(payload), images: [], directorSubmissions: [], includesImages: false };
  },
};

export const localImageStore = {
  async saveEvidenceImages(files: File[], evidenceId = "capture-evidence"): Promise<LocalImageMetadata[]> {
    const existing = await getAllStoredImages();
    const startOrder = existing.filter((image) => image.evidenceId === evidenceId).length;
    const results: LocalImageMetadata[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file.type.startsWith("image/")) throw new Error("يرجى اختيار ملفات صور فقط");
      const optimized = await compressForStorage(file);
      const image: StoredImage = {
        id: buildImageId(),
        name: file.name || "صورة شاهد",
        type: optimized.type,
        size: optimized.blob.size,
        originalSize: file.size,
        evidenceId,
        order: startOrder + index,
        compressed: optimized.compressed,
        updatedAt: new Date().toISOString(),
        blob: optimized.blob,
      };
      await putStoredImage(image);
      const { blob: _blob, ...metadata } = image;
      results.push(metadata);
    }
    return results;
  },

  async listEvidenceImages(evidenceId = "capture-evidence"): Promise<Array<{ metadata: LocalImageMetadata; url: string }>> {
    const images = await getAllStoredImages();
    return images
      .filter((image) => image.evidenceId === evidenceId)
      .sort((first, second) => first.order - second.order)
      .map(({ blob, ...metadata }) => ({ metadata, url: URL.createObjectURL(blob) }));
  },

  async listImagesForEvidenceIds(evidenceIds: string[]): Promise<Array<{ metadata: LocalImageMetadata; url: string }>> {
    const acceptedIds = new Set(evidenceIds);
    const images = await getAllStoredImages();
    return images
      .filter((image) => acceptedIds.has(image.evidenceId))
      .sort((first, second) => first.updatedAt.localeCompare(second.updatedAt) || first.order - second.order)
      .map(({ blob, ...metadata }) => ({ metadata, url: URL.createObjectURL(blob) }));
  },

  async getBlobsForEvidenceIds(evidenceIds: string[]): Promise<Blob[]> {
    const acceptedIds = new Set(evidenceIds);
    const images = await getAllStoredImages();
    return images
      .filter((image) => acceptedIds.has(image.evidenceId))
      .sort((first, second) => first.updatedAt.localeCompare(second.updatedAt) || first.order - second.order)
      .map((image) => image.blob);
  },

  async loadEvidenceOverview(evidenceId = "capture-evidence"): Promise<{ images: Array<{ metadata: LocalImageMetadata; url: string }>; summary: { used: number; quota: number | null; imageCount: number } }> {
    const storedImages = await getAllStoredImages();
    const estimate = await navigator.storage?.estimate?.();
    return {
      images: storedImages
        .filter((image) => image.evidenceId === evidenceId)
        .sort((first, second) => first.order - second.order)
        .map(({ blob, ...metadata }) => ({ metadata, url: URL.createObjectURL(blob) })),
      summary: {
        used: storedImages.reduce((total, image) => total + image.size, 0),
        quota: estimate?.quota || null,
        imageCount: storedImages.length,
      },
    };
  },

  async getBlob(id: string): Promise<Blob | null> {
    return (await getStoredImage(id))?.blob || null;
  },

  async getFirstBlobForEvidence(evidenceId: string): Promise<Blob | null> {
    const images = await getAllStoredImages();
    return images.filter((image) => image.evidenceId === evidenceId).sort((first, second) => first.order - second.order)[0]?.blob || null;
  },

  async deleteImage(id: string) {
    await deleteStoredImage(id);
  },

  async deleteEvidenceImages(evidenceId = "capture-evidence") {
    const images = await getAllStoredImages();
    await Promise.all(images.filter((image) => image.evidenceId === evidenceId).map((image) => deleteStoredImage(image.id)));
  },

  async restoreBackupImages(images: BackupImage[]) {
    await restoreStoredImages(images);
  },

  async storageSummary(): Promise<{ used: number; quota: number | null; imageCount: number }> {
    const images = await getAllStoredImages();
    const estimate = await navigator.storage?.estimate?.();
    return { used: images.reduce((total, image) => total + image.size, 0), quota: estimate?.quota || null, imageCount: images.length };
  },

  async saveCapture(file: File): Promise<LocalImageMetadata> {
    await this.deleteEvidenceImages();
    const [metadata] = await this.saveEvidenceImages([file]);
    return metadata;
  },

  async loadCapture(): Promise<{ metadata: LocalImageMetadata; url: string } | null> {
    const [image] = await this.listEvidenceImages();
    return image || null;
  },

  async deleteCapture() {
    await this.deleteEvidenceImages();
  },
};
