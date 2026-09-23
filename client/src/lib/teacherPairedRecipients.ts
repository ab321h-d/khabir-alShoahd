/**
 * PHASE NEXT-2D-C + PHASE NEXT-2D-C-FIX1 — تخزين محلي للمستلمين
 * المُقترَنين (جانب المعلم). **صفر ربط بـ directorTrustRegistry.ts/
 * senderTrust.ts/resolveSenderTrust تحت أي ظرف** — الاقتران لا يُنشئ ثقة
 * مُرسِل ولا تفويضًا ولا عضوية مدرسة، فقط "وجهة تشفير مختارة صراحة".
 *
 * PHASE NEXT-2D-C-FIX1: كل عملية قرار+كتابة (pairRecipient،
 * confirmRecipientKeyChange) تحدث **داخل معاملة IndexedDB readwrite
 * واحدة ذرية** — القراءة والمقارنة والكتابة الشرطية كلها ضمن نفس
 * الـtransaction نفسها، لا معاملتين منفصلتين (قراءة ثم كتابة). هذا
 * يمنع فعليًا سباقًا (race) من سياق/تبويب آخر يُعدِّل السجل بين القراءة
 * والكتابة — الذرية هنا حقيقية مضمونة بنيويًا من IndexedDB نفسها، لا
 * ادّعاءً وصفيًا فقط. **كل مدخل** (payload من pairRecipient،
 * newPayload من confirmRecipientKeyChange) يمر أولًا عبر
 * validateDirectorPairingPayload الكاملة — صفر ثقة بأي نوع TypeScript
 * وحده كحد أمني وقت التشغيل.
 */
import { computeDirectorEncryptionKeyFingerprint, validateDirectorPairingPayload, type DirectorPairingPayloadV1 } from "./directorPairingPayload";

const DATABASE_NAME = "khabir-teacher-paired-recipients-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "pairedRecipients";

export interface PairedRecipient {
  recipientId: string;
  encryptionKeyFingerprint: string;
  publicKeyJwk: JsonWebKey;
  displayLabel?: string;
  pairedAt: string;
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

const requestAsPromise = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const getPairedRecipient = async (recipientId: string): Promise<PairedRecipient | null> => {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const result = await requestAsPromise(transaction.objectStore(STORE_NAME).get(recipientId));
    return (result as PairedRecipient | undefined) ?? null;
  } finally {
    database.close();
  }
};

export type PairRecipientOutcome =
  | { status: "paired"; record: PairedRecipient }
  | { status: "unchanged"; record: PairedRecipient }
  | { status: "key_change_required"; existing: PairedRecipient; incoming: DirectorPairingPayloadV1 }
  | { status: "invalid_payload"; reason: string };

/**
 * §1/§6: يتحقق أولًا من كامل الحمولة عبر validateDirectorPairingPayload
 * (بصرف النظر عن نوعها المُعلَن وقت الترجمة)، ثم يُنفِّذ القراءة+القرار+
 * الكتابة الشرطية **داخل معاملة readwrite واحدة ذرية** — صفر معاملة قراءة
 * منفصلة عن الكتابة.
 */
export const pairRecipient = async (payload: unknown): Promise<PairRecipientOutcome> => {
  const validation = await validateDirectorPairingPayload(payload);
  if (!validation.ok) return { status: "invalid_payload", reason: validation.reason };
  const validPayload = validation.payload;

  const database = await openDatabase();
  try {
    return await new Promise<PairRecipientOutcome>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(validPayload.recipientId);

      getRequest.onsuccess = () => {
        const existing = (getRequest.result as PairedRecipient | undefined) ?? null;

        if (existing) {
          if (existing.encryptionKeyFingerprint === validPayload.directorEncryptionKeyFingerprint) {
            resolve({ status: "unchanged", record: existing }); // idempotent — صفر put إطلاقًا
            return;
          }
          resolve({ status: "key_change_required", existing, incoming: validPayload }); // صفر put إطلاقًا
          return;
        }

        const record: PairedRecipient = {
          recipientId: validPayload.recipientId,
          encryptionKeyFingerprint: validPayload.directorEncryptionKeyFingerprint,
          publicKeyJwk: validPayload.directorEncryptionPublicKeyJwk,
          pairedAt: new Date().toISOString(),
          ...(validPayload.displayName ? { displayLabel: validPayload.displayName } : {}),
        };
        store.put(record);
        transaction.oncomplete = () => resolve({ status: "paired", record });
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.onerror = () => reject(transaction.error);
      // PHASE NEXT-2D-C-FIX2: onabort صريح — لو أُجهضت المعاملة (مثلًا
      // بسبب QuotaExceededError أو تدخل خارجي) دون أن يُطلَق onerror، لا
      // يجوز أن يبقى الـPromise معلَّقًا إلى الأبد.
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
};

export type ConfirmKeyChangeResult =
  | { ok: true; record: PairedRecipient }
  | { ok: false; reason: "stale_old_fingerprint" | "wrong_new_fingerprint" | "recipient_not_found" | "recipient_mismatch" | "invalid_payload" };

/**
 * §3/§4/§5: تأكيد صريح واحد فقط يُسمَح له باستبدال المفتاح.
 *   1. newPayload يمر عبر validateDirectorPairingPayload كاملة أولًا
 *      (fingerprint يُعاد حسابه فعليًا هنا أيضًا — صفر ثقة بالمُرفَق).
 *   2. newPayload.recipientId يجب أن يطابق recipientId المُمرَّر حرفيًا،
 *      وإلا رفض فوري (recipient_mismatch) قبل أي قراءة/كتابة.
 *   3. القراءة الحالية + مقارنة expectedOldFingerprint + الكتابة الشرطية
 *      تحدث **جميعها داخل معاملة readwrite واحدة ذرية حقيقية** — سياق
 *      آخر يُعدِّل السجل بين القراءة والكتابة مستحيل بنيويًا هنا (كلاهما
 *      ضمن نفس الـtransaction، تُنفَّذ بالتسلسل من IndexedDB نفسها).
 */
export const confirmRecipientKeyChange = async (
  recipientId: string,
  expectedOldFingerprint: string,
  expectedNewFingerprint: string,
  newPayload: unknown,
): Promise<ConfirmKeyChangeResult> => {
  const validation = await validateDirectorPairingPayload(newPayload);
  if (!validation.ok) return { ok: false, reason: "invalid_payload" };
  const validNewPayload = validation.payload;

  if (validNewPayload.recipientId !== recipientId) {
    return { ok: false, reason: "recipient_mismatch" };
  }
  if (validNewPayload.directorEncryptionKeyFingerprint !== expectedNewFingerprint) {
    return { ok: false, reason: "wrong_new_fingerprint" };
  }

  const database = await openDatabase();
  try {
    return await new Promise<ConfirmKeyChangeResult>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(recipientId);

      getRequest.onsuccess = () => {
        const existing = (getRequest.result as PairedRecipient | undefined) ?? null;
        if (!existing) {
          resolve({ ok: false, reason: "recipient_not_found" });
          return;
        }
        if (existing.encryptionKeyFingerprint !== expectedOldFingerprint) {
          resolve({ ok: false, reason: "stale_old_fingerprint" }); // صفر put — السجل تغيَّر فعليًا منذ عرض التحذير
          return;
        }

        const record: PairedRecipient = {
          recipientId,
          encryptionKeyFingerprint: validNewPayload.directorEncryptionKeyFingerprint,
          publicKeyJwk: validNewPayload.directorEncryptionPublicKeyJwk,
          pairedAt: new Date().toISOString(),
          ...(validNewPayload.displayName ? { displayLabel: validNewPayload.displayName } : {}),
        };
        store.put(record);
        transaction.oncomplete = () => resolve({ ok: true, record });
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.onerror = () => reject(transaction.error);
      // PHASE NEXT-2D-C-FIX2: onabort صريح — لو أُجهضت المعاملة (مثلًا
      // بسبب QuotaExceededError أو تدخل خارجي) دون أن يُطلَق onerror، لا
      // يجوز أن يبقى الـPromise معلَّقًا إلى الأبد.
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
};

// مُصدَّرة للاختبار فقط
export const __recomputeFingerprintForTests = computeDirectorEncryptionKeyFingerprint;
