/**
 * PHASE NEXT-2C + PHASE NEXT-2C-API-BOUNDARY — هوية تشفير المدير (Director
 * encryption identity). مسؤوليتها **فقط**: توليد/تخزين مفتاح ECDH P-256
 * محليًا، ثم تنفيذ خطوة ECDH داخليًا عند الطلب. **منفصلة تمامًا** عن
 * directorActivationCrypto.ts (توقيع تفعيل المدير) — صفر تشارك مفاتيح.
 *
 * PHASE NEXT-2C-API-BOUNDARY — تشديد حدود API: هذا الملف هو **المالك
 * الوحيد** للمفتاح الخاص — صفر واجهة عامة تُعيد privateKey/keyPair/
 * CryptoKey الخاص أو أي سجل تخزين داخلي تحت أي ظرف. أي مستدعٍ خارجي
 * يحتاج نتيجة ECDH يحصل فقط على ArrayBuffer (سر مُشتَرَك عابر خام)، لا
 * أي مرجع قابل لإعادة استخدامه لعمليات أخرى (sign/decrypt متكررة، إلخ).
 * هذا يمنع تمامًا الثغرة السابقة: privateKey.extractable=false يمنع
 * استخراج البايتات الخام فقط، لا يمنع أي مستدعٍ يملك مرجع CryptoKey من
 * استخدامه مباشرة — الحل الحقيقي هو عدم تسريب المرجع نفسه إطلاقًا.
 */

const DATABASE_NAME = "khabir-director-encryption-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "encryptionKeyPair";
const SINGLETON_KEY = "current"; // نظير واحد فقط لكل تثبيت مدير — مطابق لنموذج المعلم

interface StoredEncryptionKeyRecord {
  key: string; // = SINGLETON_KEY دائمًا
  privateKey: CryptoKey; // extractable=false — لا يُعاد أبدًا خارج هذا الملف
  publicKeyJwk: JsonWebKey;
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

const readStoredRecord = (database: IDBDatabase): Promise<StoredEncryptionKeyRecord | null> => new Promise((resolve, reject) => {
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).get(SINGLETON_KEY);
  request.onsuccess = () => { database.close(); resolve((request.result as StoredEncryptionKeyRecord | undefined) ?? null); };
  request.onerror = () => { database.close(); reject(request.error); };
});

const writeStoredRecord = (database: IDBDatabase, record: StoredEncryptionKeyRecord): Promise<void> => new Promise((resolve, reject) => {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  transaction.oncomplete = () => { database.close(); resolve(); };
  transaction.onerror = () => { database.close(); reject(transaction.error); };
});

/**
 * دالة داخلية بحتة (غير مُصدَّرة) — الوحيدة في كل المشروع التي تحمل مرجعًا
 * لـCryptoKey الخاص للمدير. تُنشئ الهوية تلقائيًا إن لم توجد، أو تُعيد
 * الموجودة — مثابرة عبر IndexedDB. **لا تُصدَّر خارج هذا الملف تحت أي ظرف**.
 */
const getOrCreateDirectorEncryptionKeyPairInternal = async (): Promise<{ privateKey: CryptoKey; publicKeyJwk: JsonWebKey }> => {
  const readDatabase = await openDatabase();
  const existing = await readStoredRecord(readDatabase);
  if (existing) {
    return { privateKey: existing.privateKey, publicKeyJwk: existing.publicKeyJwk };
  }

  // extractable=false — مؤكَّد تجريبيًا (PHASE NEXT-2C-FIX1): privateKey.extractable
  // يصبح false فعليًا، بينما publicKey.extractable يبقى true دائمًا (سلوك
  // W3C Web Crypto المُواصَف رسميًا لأزواج المفاتيح غير المتماثلة).
  const keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const record: StoredEncryptionKeyRecord = {
    key: SINGLETON_KEY,
    privateKey: keyPair.privateKey,
    publicKeyJwk,
    createdAt: new Date().toISOString(),
  };
  const writeDatabase = await openDatabase();
  await writeStoredRecord(writeDatabase, record);

  return { privateKey: keyPair.privateKey, publicKeyJwk };
};

/**
 * المفتاح العام فقط — آمن للمشاركة (QR/pairing مستقبلًا، خارج نطاق هذه
 * المرحلة). ينشئ الهوية تلقائيًا إن لم توجد.
 */
export const getOrCreateDirectorEncryptionPublicKey = async (): Promise<JsonWebKey> => {
  const identity = await getOrCreateDirectorEncryptionKeyPairInternal();
  return identity.publicKeyJwk;
};

/**
 * العملية الوحيدة التي "تلمس" المفتاح الخاص المُخزَّن فعليًا — تستورد
 * المفتاح العام العابر المُستلَم، تنفِّذ ECDH deriveBits(..., 256) داخل
 * هذا الملف فقط، وتُعيد السر المُشتَرَك الخام **كـArrayBuffer فقط**، لا
 * أي مرجع CryptoKey. السر الناتج مادة حساسة عابرة لهذه العملية وحدها —
 * صفر تخزين (IndexedDB/localStorage)، صفر تسلسل/base64، صفر تسجيل
 * (logging)، صفر تضمين في أي envelope أو استدعاء شبكة — يُستهلَك فورًا
 * من طرف المستدعي (اشتقاق HKDF) ثم يُترَك لجامع القمامة.
 */
export const deriveDirectorSharedSecretBits = async (ephemeralPublicKeyJwk: JsonWebKey): Promise<ArrayBuffer> => {
  const identity = await getOrCreateDirectorEncryptionKeyPairInternal();
  const ephemeralPublicKey = await crypto.subtle.importKey("jwk", ephemeralPublicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveBits({ name: "ECDH", public: ephemeralPublicKey }, identity.privateKey, 256);
};
