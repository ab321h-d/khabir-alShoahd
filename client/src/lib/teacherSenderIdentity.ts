/**
 * PHASE PILOT-50-F — هوية مرسل تشفيرية للمعلم (Teacher cryptographic
 * sender identity). مسؤوليتها **فقط**: توليد/تخزين مفتاح ECDSA P-256
 * محليًا، تصدير المفتاح العام، توقيع manifest. **صفر علاقة** بترخيص
 * المعلم (licenseStore.ts) أو مصادقة المدير (directorAuth.ts) — نظام
 * مستقل تمامًا بقاعدة IndexedDB معزولة خاصة به، مطابق تمامًا لمبدأ
 * الفصل الصارم المُطبَّق طوال المشروع (khabir-identity-local،
 * khabir-license-local، khabir-teacher-credentials-local... إلخ).
 *
 * المعلم لا يقوم بأي إجراء تشفيري يدوي إطلاقًا — التوليد يحدث تلقائيًا
 * وشفافيًا عند أول حاجة فعلية (أول تصدير حزمة).
 */
import { buildCanonicalPublicKeyString, computeSenderFingerprint, sha256HexOfBytes, signCanonicalManifest, type SignedManifestV1 } from "./teacherManifestCrypto";

const DATABASE_NAME = "khabir-teacher-sender-identity-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "senderKeyPair";
const SINGLETON_KEY = "current"; // نظير واحد فقط لكل تثبيت — مطابق لنموذج onboarding الحالي (معلم واحد لكل جهاز)

interface StoredSenderKeyRecord {
  key: string; // = SINGLETON_KEY دائمًا
  privateKey: CryptoKey; // extractable=false — Web Crypto CryptoKey مدعومة بنيويًا للتخزين المباشر في IndexedDB
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
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

const readStoredRecord = (database: IDBDatabase): Promise<StoredSenderKeyRecord | null> => new Promise((resolve, reject) => {
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).get(SINGLETON_KEY);
  request.onsuccess = () => { database.close(); resolve((request.result as StoredSenderKeyRecord | undefined) ?? null); };
  request.onerror = () => { database.close(); reject(request.error); };
});

const writeStoredRecord = (database: IDBDatabase, record: StoredSenderKeyRecord): Promise<void> => new Promise((resolve, reject) => {
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  transaction.oncomplete = () => { database.close(); resolve(); };
  transaction.onerror = () => { database.close(); reject(transaction.error); };
});

export interface TeacherSenderIdentity {
  privateKey: CryptoKey; // للاستخدام الداخلي (التوقيع) فقط — **يجب ألا يُمرَّر خارج هذا الملف إلى أي دالة بناء حزمة/تصدير**
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
}

/**
 * تُنشئ هوية مرسل جديدة تلقائيًا إن لم توجد، أو تُعيد الموجودة — مثابرة
 * عبر إعادة الفتح/إعادة التشغيل (تُخزَّن في IndexedDB، لا في ذاكرة runtime).
 * صفر خطوة يدوية من المعلم؛ صفر رمز/PIN/إدخال إضافي مطلوب لهذه العملية.
 */
export const getOrCreateTeacherSenderIdentity = async (): Promise<TeacherSenderIdentity> => {
  const readDatabase = await openDatabase();
  const existing = await readStoredRecord(readDatabase);
  if (existing) {
    return { privateKey: existing.privateKey, publicKeyJwk: existing.publicKeyJwk, fingerprint: existing.fingerprint };
  }

  // extractable=false على الاستدعاء بأكمله — مؤكَّد تجريبيًا (PILOT-50-E2/E3):
  // privateKey.extractable يصبح false فعليًا (Web Crypto spec)، بينما
  // publicKey.extractable يبقى true دائمًا (سلوك مُواصَف رسميًا لأزواج
  // المفاتيح غير المتماثلة)، فيُمكِن تصديره لاحقًا بأمان تام.
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const fingerprint = await computeSenderFingerprint(publicKeyJwk);

  const record: StoredSenderKeyRecord = {
    key: SINGLETON_KEY,
    privateKey: keyPair.privateKey, // CryptoKey غير قابل للاستخراج يُخزَّن مباشرة — صفر تسلسل نصي/تصدير بايتات خام
    publicKeyJwk,
    fingerprint,
    createdAt: new Date().toISOString(),
  };
  // اتصال منفصل تمامًا للكتابة — readDatabase أُغلِق بالفعل داخل readStoredRecord أعلاه
  const writeDatabase = await openDatabase();
  await writeStoredRecord(writeDatabase, record);

  return { privateKey: keyPair.privateKey, publicKeyJwk, fingerprint };
};

/**
 * تبني manifest مُوقَّعًا كاملًا جاهزًا للتضمين في الحزمة، بناءً على هوية
 * المرسل الحالية وbytes الملفَين الفعليَّين (الخام، لا مُعاد تسلسلهما).
 * **المفتاح الخاص لا يُغادر هذا الملف إطلاقًا** — الدالة تُعيد فقط
 * {manifest, signature} كنص/JSON، صفر أي مرجع لـCryptoKey في الناتج.
 */
export const buildSignedManifestForExport = async (input: {
  exportId: string;
  generatedAt: string;
  displayName: string;
  stage: string;
  pdfBytes: Uint8Array;
  completenessJsonBytes: Uint8Array;
}): Promise<{ manifest: SignedManifestV1; signature: string }> => {
  const identity = await getOrCreateTeacherSenderIdentity();

  const manifest: SignedManifestV1 = {
    schemaVersion: 1,
    exportId: input.exportId,
    generatedAt: input.generatedAt,
    senderFingerprint: identity.fingerprint,
    senderPublicKeyJwk: identity.publicKeyJwk,
    displayName: input.displayName,
    stage: input.stage,
    files: {
      "portfolio.pdf": await sha256HexOfBytes(input.pdfBytes),
      "completeness.json": await sha256HexOfBytes(input.completenessJsonBytes),
    },
  };

  const signature = await signCanonicalManifest(manifest, identity.privateKey);
  return { manifest, signature };
};

// مُصدَّرة لأغراض الاختبار فقط (فحص التمثيل الحتمي للمفتاح العام مباشرة)
export const __exportBuildCanonicalPublicKeyString = buildCanonicalPublicKeyString;
