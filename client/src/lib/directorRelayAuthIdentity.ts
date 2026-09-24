/**
 * PHASE NEXT-2E-B1B — هوية مصادقة relay المدير (Director Relay-Auth
 * Identity). ECDSA P-256 **منفصلة تمامًا** عن مفتاح تشفير المدير (ECDH،
 * directorEncryptionIdentity.ts) — أغراض مستقلة تمامًا (توقيع طلبات
 * مقابل تشفير حزم)، صفر تشارك مفاتيح تحت أي ظرف.
 *
 * **حد API صارم** (نفس درس NEXT-2C-API-BOUNDARY): هذا الملف هو المالك
 * الوحيد للمفتاح الخاص — صفر واجهة عامة تُعيد privateKey/keyPair. أي
 * مستدعٍ يحتاج توقيعًا يحصل فقط على ArrayBuffer (نتيجة توقيع)، لا مرجع
 * CryptoKey قابل لإعادة استخدامه.
 *
 * **دلالة أمنية مُقفَلة**: امتلاك هذا المفتاح يُثبِت فقط "التحكم بمفتاح
 * relay-auth محلي مرتبط بـrecipientId" — صفر إثبات لهوية مدير/مدرسة/دور
 * رسمي. الذرية: معاملة IndexedDB readwrite واحدة (get → put شرطي)،
 * نفس نمط directorRecipientProfile.ts الصحيح — **صفر تكرار** لسباق
 * التهيئة الأول المعروف في directorEncryptionIdentity.ts الأصلية.
 */

const DATABASE_NAME = "khabir-director-relay-auth-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "relayAuthKeyPair";
const SINGLETON_KEY = "current";

interface StoredRelayAuthKeyRecord {
  key: string; // = SINGLETON_KEY دائمًا
  privateKey: CryptoKey; // extractable=false — صفر إعادة له خارج هذا الملف
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

/**
 * دالة داخلية بحتة (غير مُصدَّرة) — الوحيدة في كل المشروع التي تحمل
 * مرجعًا لـCryptoKey الخاص لـrelay-auth المدير. تهيئة ذرية بالكامل:
 * get → put شرطي **ضمن نفس معاملة readwrite الواحدة** — صفر معاملة
 * قراءة منفصلة عن الكتابة (تصحيح صريح لعدم توريث سباق NEXT-2C).
 *
 * ملاحظة تقنية مهمة: توليد المفتاح (crypto.subtle.generateKey/exportKey،
 * عمليات async حقيقية) يحدث **قبل** فتح المعاملة عمدًا — IndexedDB يُغلِق
 * المعاملة تلقائيًا لو انتظرت await غير متزامن مع IDB نفسه أثناءها (سلوك
 * قياسي)، فتوليد المفتاح داخل المعاملة كان سيُبطلها. المفتاح يُولَّد
 * تفاؤليًا مسبقًا؛ لو تبيَّن لاحقًا (داخل المعاملة نفسها، متزامن تمامًا)
 * أن سجلًا موجودًا بالفعل، المفتاح المُولَّد حديثًا **يُهمَل بالكامل ولا
 * يُكتَب أبدًا** — الذرية الفعلية للقرار (created أم existing) تبقى
 * محفوظة تمامًا ضمن معاملة IDB واحدة متزامنة.
 */
const getOrCreateDirectorRelayAuthKeyPairInternal = async (): Promise<{ privateKey: CryptoKey; publicKeyJwk: JsonWebKey }> => {
  // extractable=false — مؤكَّد تجريبيًا سابقًا (نفس سلوك ECDSA في
  // teacherSenderIdentity.ts/directorActivationCrypto.ts): privateKey
  // غير قابل للاستخراج فعليًا، publicKey يبقى قابلًا للتصدير دائمًا.
  const candidateKeyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const candidatePublicKeyJwk = await crypto.subtle.exportKey("jwk", candidateKeyPair.publicKey);

  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const getRequest = store.get(SINGLETON_KEY);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as StoredRelayAuthKeyRecord | undefined;
        if (existing) {
          resolve({ privateKey: existing.privateKey, publicKeyJwk: existing.publicKeyJwk }); // المفتاح المُولَّد حديثًا يُهمَل تمامًا — صفر put
          return;
        }

        const record: StoredRelayAuthKeyRecord = { key: SINGLETON_KEY, privateKey: candidateKeyPair.privateKey, publicKeyJwk: candidatePublicKeyJwk, createdAt: new Date().toISOString() };
        store.put(record); // متزامن تمامًا مع getRequest.onsuccess نفسها — صفر await بينهما
        transaction.oncomplete = () => resolve({ privateKey: candidateKeyPair.privateKey, publicKeyJwk: candidatePublicKeyJwk });
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally {
    database.close();
  }
};

/** نفس التمثيل القانوني الحتمي المُستخدَم عبر كل المشروع (directorPairingPayload.ts وخادم B1A). */
const buildCanonicalPublicKeyString = (jwk: JsonWebKey): string => `EC:P-256:${jwk.x}:${jwk.y}`;

const bytesToBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

/** المفتاح العام فقط — آمن للإرسال في طلب التسجيل. ينشئ الهوية تلقائيًا إن لم توجد. */
export const getOrCreateDirectorRelayAuthPublicKey = async (): Promise<JsonWebKey> => {
  const identity = await getOrCreateDirectorRelayAuthKeyPairInternal();
  return identity.publicKeyJwk;
};

/** fingerprint كامل حتمي — نفس الخوارزمية المُستخدَمة للمفتاح العام في المشروع/الخادم. */
export const computeDirectorRelayAuthFingerprint = async (): Promise<string> => {
  const identity = await getOrCreateDirectorRelayAuthKeyPairInternal();
  const bytes = new TextEncoder().encode(buildCanonicalPublicKeyString(identity.publicKeyJwk));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToBase64Url(new Uint8Array(hash));
};

/**
 * العملية الوحيدة التي "تلمس" المفتاح الخاص المُخزَّن فعليًا — توقّع
 * البايتات المُمرَّرة وتُعيد **فقط** ناتج التوقيع الخام (ArrayBuffer، raw
 * r‖s لـP-256 = 64 بايت، سلوك WebCrypto القياسي)، لا أي مرجع CryptoKey.
 */
export const signWithDirectorRelayAuthKey = async (bytes: Uint8Array): Promise<ArrayBuffer> => {
  const identity = await getOrCreateDirectorRelayAuthKeyPairInternal();
  return crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.privateKey, bytes as BufferSource);
};
