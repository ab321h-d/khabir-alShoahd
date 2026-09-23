/**
 * PHASE NEXT-2D-D-B — ملف تعريف مستلم المدير الثابت (Director Recipient
 * Profile). مسؤوليته **فقط**: recipientId ثابت + createdAt، يُنشَأ مرة
 * واحدة ويبقى ثابتًا عبر كل عروض QR/إعادة تحميل مستقبلية.
 *
 * **مستقل بنيويًا تمامًا** عن directorEncryptionIdentity.ts (هوية التشفير)
 * — قاعدة IndexedDB منفصلة تمامًا، صفر مشاركة سجل. هذا يمنع بنيويًا خطر
 * الكتابة العرضية فوق recipientId عند دوران/تحديث مفتاح التشفير مستقبلًا
 * (مؤكَّد NEXT-2D-D-B-AUDIT/§4: دوران المفتاح يجب ألا يُغيِّر recipientId
 * إطلاقًا، والفصل البنيوي هو الضمان الأصلب لهذا).
 *
 * **صفر إصلاح** لسباق التهيئة الموجود فعليًا في directorEncryptionIdentity.ts
 * (NEXT-2C) — خارج نطاق هذه المرحلة عمدًا. لكن هذا الملف نفسه **لا يُكرِّر**
 * ذلك الخطأ: التهيئة هنا ذرية بالكامل ضمن معاملة readwrite واحدة (§4).
 */
import { generateRecipientId } from "./directorPairingPayload";

const DATABASE_NAME = "khabir-director-recipient-profile-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "recipientProfile";
const SINGLETON_KEY = "current";

interface StoredRecipientProfileRecord {
  key: "current";
  recipientId: string;
  createdAt: string;
}

export interface DirectorRecipientProfile {
  recipientId: string;
  createdAt: string;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: "key" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** نفس صيغة base64url المُولَّدة عبر generateRecipientId (16 بايت خام = 22 حرفًا، بلا padding). */
const RECIPIENT_ID_FORMAT = /^[A-Za-z0-9_-]{22}$/;

/**
 * PHASE NEXT-2D-D-B-FIX1: عقد المثابرة يُنشئ createdAt حصرًا عبر
 * `new Date().toISOString()` — التحقق يجب أن يفرض هذه الصيغة القانونية
 * الدقيقة (round-trip)، لا مجرد "Date قابل للتحليل" (new Date(x).getTime()
 * وحدها تقبل صيغًا كثيرة أخرى مثل تاريخ بلا وقت، أو صيغًا محلية غامضة).
 */
const isCanonicalIsoTimestamp = (value: string): boolean => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};

const isValidStoredRecord = (value: unknown): value is StoredRecipientProfileRecord => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.key !== SINGLETON_KEY) return false;
  if (typeof record.recipientId !== "string" || !RECIPIENT_ID_FORMAT.test(record.recipientId)) return false;
  if (typeof record.createdAt !== "string" || !isCanonicalIsoTimestamp(record.createdAt)) return false;
  return true;
};

export class CorruptedRecipientProfileError extends Error {
  constructor() {
    // PHASE NEXT-2D-D-B/§5: fail-closed صريح — صفر استبدال صامت لسجل
    // موجود لكن تالف، لأن ذلك قد يُغيِّر هوية التوجيه (recipientId) بصمت
    // دون علم أي طرف اعتمد على القيمة القديمة.
    super("Stored director recipient profile is corrupted/malformed — refusing to silently regenerate a new recipientId.");
    this.name = "CorruptedRecipientProfileError";
  }
}

/**
 * §4 — تهيئة ذرية بالكامل: get("current") ثم put الشرطي (فقط لو غير
 * موجود) **ضمن نفس معاملة readwrite الواحدة** — صفر معاملة قراءة منفصلة
 * عن الكتابة (نفس نمط FIX1 الذري المُثبَت سابقًا في teacherPairedRecipients.ts).
 * استدعاءات متزامنة (Promise.all) على نفس المخزن تُنفَّذ بالتسلسل من
 * IndexedDB نفسها — صفر إمكانية لسباق يُنتِج recipientId مزدوجًا.
 *
 * §5 — سجل موجود لكن تالف/مُشوَّه (شكل recipientId غير مطابق، createdAt
 * غير صالح، مفتاح غير "current"): **fail-closed صريح** — يرمي
 * CorruptedRecipientProfileError، **صفر استبدال صامت**.
 */
export const getOrCreateDirectorRecipientProfile = async (): Promise<DirectorRecipientProfile> => {
  const database = await openDatabase();
  try {
    return await new Promise<DirectorRecipientProfile>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(SINGLETON_KEY);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as unknown;

        if (existing !== undefined) {
          if (!isValidStoredRecord(existing)) {
            reject(new CorruptedRecipientProfileError());
            return;
          }
          resolve({ recipientId: existing.recipientId, createdAt: existing.createdAt }); // صفر put — القراءة فقط
          return;
        }

        const record: StoredRecipientProfileRecord = {
          key: SINGLETON_KEY,
          recipientId: generateRecipientId(),
          createdAt: new Date().toISOString(),
        };
        store.put(record);
        transaction.oncomplete = () => resolve({ recipientId: record.recipientId, createdAt: record.createdAt });
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
};
