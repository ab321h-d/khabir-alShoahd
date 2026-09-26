/**
 * PHASE NEXT-2E-B2-A2-B — متجر محلي **مستقل تمامًا** عن
 * teacherPairedRecipients.ts (pairing = اختيار وجهة تشفير فقط). هذا
 * المتجر يحمل **تفويض رفع bearer فقط** — صفر دمج، صفر مشاركة سجل، صفر
 * حقل capabilitySecret في أي مكان من PairedRecipient.
 *
 * نفس نمط الذرية/منع الاستبدال الصامت المُثبَت في teacherPairedRecipients.ts
 * (pairRecipient/confirmRecipientKeyChange) — idempotent لنفس القيم،
 * "replace_required" صريح لقيم مختلفة (صفر كتابة تلقائية)، تأكيد
 * TOCTOU-safe منفصل يتطلب معرفة القيمة القديمة المُتوقَّعة تحديدًا.
 */

const DATABASE_NAME = "khabir-teacher-relay-upload-capability-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "uploadCapabilities";

export interface StoredUploadCapability {
  recipientId: string;
  capabilityId: string;
  capabilitySecret: string;
  storedAt: string;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: "recipientId" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const RECIPIENT_ID_FORMAT = /^[A-Za-z0-9_-]{22}$/;
const CAPABILITY_ID_FORMAT = /^[A-Za-z0-9_-]{22}$/;
const CAPABILITY_SECRET_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** تحقق runtime صارم على أي سجل مقروء من IndexedDB — سجل مُشوَّه fail-closed (يُعامَل كغائب)، صفر ثقة بالنوع وحده. */
const isValidStoredRecord = (value: unknown): value is StoredUploadCapability => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.recipientId !== "string" || !RECIPIENT_ID_FORMAT.test(record.recipientId)) return false;
  if (typeof record.capabilityId !== "string" || !CAPABILITY_ID_FORMAT.test(record.capabilityId)) return false;
  if (typeof record.capabilitySecret !== "string" || !CAPABILITY_SECRET_FORMAT.test(record.capabilitySecret)) return false;
  if (typeof record.storedAt !== "string" || Number.isNaN(new Date(record.storedAt).getTime())) return false;
  return true;
};

/** سجل مُشوَّه يُعامَل كغائب تمامًا (fail-closed) — صفر رمي استثناء يُعطِّل التدفق، صفر افتراض بيانات تالفة صالحة. */
export const getStoredUploadCapability = async (recipientId: string): Promise<StoredUploadCapability | null> => {
  const database = await openDatabase();
  try {
    const record = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(recipientId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (record === undefined) return null;
    return isValidStoredRecord(record) ? record : null;
  } finally {
    database.close();
  }
};

export type SaveUploadCapabilityOutcome =
  | { status: "saved"; record: StoredUploadCapability }
  | { status: "unchanged"; record: StoredUploadCapability }
  | { status: "replace_required"; existing: StoredUploadCapability };

/**
 * يُستدعى فقط بعد نجاح redemption مُتحقَّق منه فعليًا (مسؤولية الطبقة
 * الأعلى — هذا الملف لا يعرف شيئًا عن HTTP). ذري بالكامل: get→قرار→put
 * الشرطي ضمن نفس معاملة readwrite واحدة (نفس نمط directorRecipientProfile.ts
 * الصحيح، تفاديًا لسباق التهيئة الأول المعروف).
 */
export const saveUploadCapability = async (payload: { recipientId: string; capabilityId: string; capabilitySecret: string }): Promise<SaveUploadCapabilityOutcome> => {
  if (!RECIPIENT_ID_FORMAT.test(payload.recipientId) || !CAPABILITY_ID_FORMAT.test(payload.capabilityId) || !CAPABILITY_SECRET_FORMAT.test(payload.capabilitySecret)) {
    throw new Error("invalid_upload_capability_payload");
  }

  const database = await openDatabase();
  try {
    return await new Promise<SaveUploadCapabilityOutcome>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(payload.recipientId);

      getRequest.onsuccess = () => {
        const existingRaw = getRequest.result as unknown;
        const existing = existingRaw !== undefined && isValidStoredRecord(existingRaw) ? existingRaw : null;

        if (existing) {
          if (existing.capabilityId === payload.capabilityId && existing.capabilitySecret === payload.capabilitySecret) {
            resolve({ status: "unchanged", record: existing }); // idempotent — صفر كتابة
            return;
          }
          resolve({ status: "replace_required", existing }); // صفر استبدال صامت — صفر كتابة
          return;
        }

        const record: StoredUploadCapability = { ...payload, storedAt: new Date().toISOString() };
        store.put(record);
        transaction.oncomplete = () => resolve({ status: "saved", record });
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
};

export type ConfirmReplaceOutcome =
  | { ok: true; record: StoredUploadCapability }
  | { ok: false; reason: "stale_existing" };

/**
 * تأكيد صريح TOCTOU-safe للاستبدال — يتطلب معرفة capabilityId **القديم**
 * المُتوقَّع تحديدًا؛ لو تغيَّر السجل المحلي فعليًا منذ عرض التحذير
 * للمستخدم (نافذة نادرة لكن ممكنة)، يفشل بأمان بدل استبدال قيمة غير
 * التي وافق عليها المستخدم. ذري ضمن معاملة واحدة (get→قرار→put).
 */
export const confirmReplaceUploadCapability = async (
  recipientId: string,
  expectedOldCapabilityId: string,
  newPayload: { capabilityId: string; capabilitySecret: string },
): Promise<ConfirmReplaceOutcome> => {
  const database = await openDatabase();
  try {
    return await new Promise<ConfirmReplaceOutcome>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(recipientId);

      getRequest.onsuccess = () => {
        const existingRaw = getRequest.result as unknown;
        const existing = existingRaw !== undefined && isValidStoredRecord(existingRaw) ? existingRaw : null;

        if (!existing || existing.capabilityId !== expectedOldCapabilityId) {
          resolve({ ok: false, reason: "stale_existing" }); // صفر كتابة
          return;
        }

        const record: StoredUploadCapability = { recipientId, capabilityId: newPayload.capabilityId, capabilitySecret: newPayload.capabilitySecret, storedAt: new Date().toISOString() };
        store.put(record);
        transaction.oncomplete = () => resolve({ ok: true, record });
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
};
