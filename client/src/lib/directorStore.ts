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
};

type StoredSubmission = DirectorSubmission & { pdf: Blob };
export type DirectorBackupSubmission = DirectorSubmission & { payload: string };

const databaseName = "khabir-director-local";
const storeName = "submissions";

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(databaseName, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, { keyPath: "id" });
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

  async save(file: File, teacherName: string, academicTerm: AcademicTerm = ""): Promise<DirectorSubmission> {
    const database = await openDatabase();
    const now = new Date().toISOString();
    const item: StoredSubmission = {
      id: crypto.randomUUID(), fileName: file.name, teacherName: teacherName.trim() || file.name.replace(/\.pdf$/i, ""), importedAt: now, updatedAt: now,
      size: file.size, reviewStatus: "new", reviewLevel: "", academicTerm, comment: "", whatsappNumber: "", whatsappMessage: "", pdf: file,
    };
    await closeWhenDone(database, requestValue(database.transaction(storeName, "readwrite").objectStore(storeName).put(item)));
    return publicRecord(item);
  },

  async update(id: string, patch: Partial<Pick<DirectorSubmission, "reviewStatus" | "reviewLevel" | "academicTerm" | "comment" | "whatsappNumber" | "whatsappMessage">>): Promise<DirectorSubmission | null> {
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
