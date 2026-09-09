import { assertWriteAllowed } from "./license/licenseGuard";
import type { CompletenessMetadata } from "./completenessCheck";
import type { SchoolStage, TeacherIdentityMetadata } from "./teacherIdentityImport";

export type ReviewStatus = "new" | "reviewed" | "follow_up";
export type ReviewLevel = "" | "متميز" | "متحقق" | "يحتاج متابعة";
// "الصيفي" قيمة قديمة محفوظة في بعض الأجهزة؛ تُقبل للقراءة فقط ثم تُعرض كعام دراسي.
export type AcademicTerm = "" | "الأول" | "الثاني" | "العام الدراسي" | "الصيفي";

export type DirectorSubmission = {
  id: string;
  fileName: string;
  teacherName: string;
  importedAt: string;
  updatedAt: string;
  size: number;
  reviewStatus: ReviewStatus;
  reviewLevel: ReviewLevel;
  academicTerm: AcademicTerm;
  comment: string;
  whatsappNumber?: string;
  whatsappMessage?: string;
  /** R-NEXT-2: تُملَأ فقط عند الاستيراد من حزمة .khabir.zip صالحة؛ اختيارية، لا تكسر السجلات القديمة. */
  completenessMetadata?: CompletenessMetadata | null;
  /**
   * PHASE ID-3D.2: هوية معلم ثابتة (identity.json مُتحقَّق منها ومُطابَقة مع
   * completeness.json) — اختيارية بالكامل، تبقى غائبة لكل الحزم/PDF القديمة
   * أو أي حزمة جديدة بلا identity.json صالح متطابق. teacherName يبقى
   * للعرض فقط، بلا أي علاقة بهذه الحقول.
   */
  teacherId?: string;
  schoolId?: string;
  stage?: SchoolStage;
  teacherDisplayName?: string;
  exportId?: string;
  identityGeneratedAt?: string;
};

type StoredSubmission = DirectorSubmission & { pdf: Blob };
export type DirectorBackupSubmission = DirectorSubmission & { payload: string };

const databaseName = "khabir-director-local";
const storeName = "submissions";
const teacherContactsStoreName = "teacherContacts";
const databaseVersion = 2;

/** R-NEXT-3: تطبيع مركزي لاسم المعلم — trim + دمج مسافات متكررة فقط، بلا مطابقة تقريبية (fuzzy). */
export const normalizeTeacherName = (name: string): string => name.trim().replace(/\s+/g, " ");

type TeacherContact = { normalizedName: string; whatsappNumber: string; updatedAt: string };

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(databaseName, databaseVersion);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
    if (!database.objectStoreNames.contains(teacherContactsStoreName)) database.createObjectStore(teacherContactsStoreName, { keyPath: "normalizedName" });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const requestValue = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const closeWhenDone = <T,>(database: IDBDatabase, value: Promise<T>) => value.finally(() => database.close());

const publicRecord = ({ pdf: _pdf, ...record }: StoredSubmission): DirectorSubmission => ({
  ...record,
  academicTerm: record.academicTerm === "الصيفي" ? "العام الدراسي" : record.academicTerm || "",
  whatsappNumber: record.whatsappNumber || "",
  whatsappMessage: record.whatsappMessage || "",
});

const toBase64 = (data: ArrayBuffer) => {
  const bytes = new Uint8Array(data);
  let text = "";
  bytes.forEach((value) => { text += String.fromCharCode(value); });
  return btoa(text);
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export const directorStore = {
  async list(): Promise<DirectorSubmission[]> {
    const database = await openDatabase();
    return closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).getAll()).then((items) => (items as StoredSubmission[]).map(publicRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  },

  /** R-NEXT-3: قراءة فقط، بلا حراسة (مطابق لتصنيف عمليات القراءة المعفاة في كل المشروع). */
  async getTeacherContact(normalizedName: string): Promise<string | null> {
    if (!normalizedName) return null;
    const database = await openDatabase();
    const contact = await closeWhenDone(database, requestValue(database.transaction(teacherContactsStoreName, "readonly").objectStore(teacherContactsStoreName).get(normalizedName)).catch(() => undefined)) as TeacherContact | undefined;
    return contact?.whatsappNumber || null;
  },

  /**
   * R-NEXT-3: fallback عند غياب Teacher Contact — يبحث في سجلات الاستيراد
   * السابقة لنفس الاسم المُطبَّع، ويعيد أحدث رقم واتساب صالح (غير فارغ) إن
   * وُجد. قراءة فقط، بلا حراسة.
   */
  async findLatestWhatsAppNumberForTeacher(normalizedName: string): Promise<string | null> {
    if (!normalizedName) return null;
    const submissions = await this.list();
    const matches = submissions
      .filter((item) => normalizeTeacherName(item.teacherName) === normalizedName && (item.whatsappNumber || "").trim().length > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return matches[0]?.whatsappNumber || null;
  },

  /** R-NEXT-3: حراسة الكتابة — upsert صريح، يمر عبر write guards الحالية. */
  async upsertTeacherContact(normalizedName: string, whatsappNumber: string): Promise<void> {
    if (!normalizedName || !whatsappNumber.trim()) return;
    await assertWriteAllowed("director");
    const database = await openDatabase();
    const contact: TeacherContact = { normalizedName, whatsappNumber, updatedAt: new Date().toISOString() };
    await closeWhenDone(database, requestValue(database.transaction(teacherContactsStoreName, "readwrite").objectStore(teacherContactsStoreName).put(contact)));
  },

  /** PHASE B.8: حراسة الكتابة (إنشاء). موقع الاستدعاء الوحيد في Director.tsx مغلَّف بـtry/catch. */
  async save(file: File, teacherName: string, academicTerm: AcademicTerm = "", completenessMetadata: CompletenessMetadata | null = null, teacherIdentity: TeacherIdentityMetadata | null = null): Promise<DirectorSubmission> {
    await assertWriteAllowed("director");
    const database = await openDatabase();
    const now = new Date().toISOString();
    const item: StoredSubmission = {
      id: crypto.randomUUID?.() || `sub-${Date.now()}-${Math.random().toString(16).slice(2)}`, fileName: file.name, teacherName: teacherName.trim() || file.name.replace(/\.pdf$/i, ""), importedAt: now, updatedAt: now,
      size: file.size, reviewStatus: "new", reviewLevel: "", academicTerm, comment: "", whatsappNumber: "", whatsappMessage: "", pdf: file, completenessMetadata,
      ...(teacherIdentity ? {
        teacherId: teacherIdentity.teacherId,
        schoolId: teacherIdentity.schoolId,
        stage: teacherIdentity.stage,
        teacherDisplayName: teacherIdentity.displayName,
        exportId: teacherIdentity.exportId,
        identityGeneratedAt: teacherIdentity.generatedAt,
      } : {}),
    };
    await closeWhenDone(database, requestValue(database.transaction(storeName, "readwrite").objectStore(storeName).put(item)));
    return publicRecord(item);
  },

  /**
   * PHASE B.8: حراسة الكتابة (تعديل). ⚠️ موقع الاستدعاء الوحيد
   * (Director.tsx: updateReview) غير مغلَّف بـtry/catch حاليًا — راجع تقرير
   * التنفيذ لتفصيل هذه النقطة (فشل صامت غير معطوب، لا انهيار).
   */
  async update(id: string, patch: Partial<Pick<DirectorSubmission, "reviewStatus" | "reviewLevel" | "academicTerm" | "comment" | "whatsappNumber" | "whatsappMessage">>): Promise<DirectorSubmission | null> {
    await assertWriteAllowed("director");
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const existing = await requestValue(store.get(id)) as StoredSubmission | undefined;
    if (!existing) { database.close(); return null; }
    const next: StoredSubmission = { ...existing, ...patch, academicTerm: patch.academicTerm ?? existing.academicTerm ?? "", updatedAt: new Date().toISOString() };
    await closeWhenDone(database, requestValue(store.put(next)));
    return publicRecord(next);
  },

  async getPdf(id: string): Promise<Blob | null> {
    const database = await openDatabase();
    return closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).get(id)).then((item) => (item as StoredSubmission | undefined)?.pdf || null));
  },

  async remove(id: string) {
    const database = await openDatabase();
    await closeWhenDone(database, requestValue(database.transaction(storeName, "readwrite").objectStore(storeName).delete(id)));
  },

  async clearAll() {
    const database = await openDatabase();
    await closeWhenDone(database, requestValue(database.transaction(storeName, "readwrite").objectStore(storeName).clear()));
  },

  async exportBackup(): Promise<DirectorBackupSubmission[]> {
    const database = await openDatabase();
    const submissions = await closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).getAll())) as StoredSubmission[];
    return Promise.all(submissions.map(async ({ pdf, ...record }) => ({ ...record, payload: toBase64(await pdf.arrayBuffer()) })));
  },

  async restoreBackup(records: DirectorBackupSubmission[]) {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      store.clear();
      records.forEach(({ payload, ...record }) => store.put({ ...record, pdf: new Blob([fromBase64(payload)], { type: "application/pdf" }) } satisfies StoredSubmission));
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    });
  },
};
