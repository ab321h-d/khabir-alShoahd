/**
 * PHASE PILOT-50-F — سجل المُرسِلين الموثوقين لدى المدير (Director Trust
 * Registry). قاعدة IndexedDB معزولة تمامًا **على جهاز المدير فقط** —
 * صفر علاقة بأي قاعدة معلم، صفر علاقة بـidentityStore.ts (هوية المدير
 * نفسه) أو directorAuth.ts (مصادقة المدير) أو evidenceStore.ts (بيانات
 * الشواهد) — نظام مستقل تمامًا، مطابق لمبدأ العزل الصارم بالمشروع.
 *
 * fingerprint هو مفتاح الهوية التشفيرية الوحيد — **الاسم وحده لا يُثبِت
 * ثقة تحت أي ظرف** (PHASE PILOT-50-E/§10).
 */

const DATABASE_NAME = "khabir-director-trust-registry-local";
const DATABASE_VERSION = 1;
const TRUSTED_SENDERS_STORE = "trustedSenders";
const SEEN_EXPORT_IDS_STORE = "seenExportIds";

export interface TrustedTeacherSender {
  fingerprint: string; // مفتاح أساسي
  publicKeyJwk: JsonWebKey;
  approvedDisplayName: string;
  approvedStage: string;
  firstApprovedAt: string;
  lastSeenAt: string;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(TRUSTED_SENDERS_STORE)) {
      database.createObjectStore(TRUSTED_SENDERS_STORE, { keyPath: "fingerprint" });
    }
    if (!database.objectStoreNames.contains(SEEN_EXPORT_IDS_STORE)) {
      database.createObjectStore(SEEN_EXPORT_IDS_STORE, { keyPath: "exportId" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const directorTrustRegistry = {
  async getByFingerprint(fingerprint: string): Promise<TrustedTeacherSender | null> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(TRUSTED_SENDERS_STORE, "readonly").objectStore(TRUSTED_SENDERS_STORE).get(fingerprint);
      request.onsuccess = () => { database.close(); resolve((request.result as TrustedTeacherSender | undefined) ?? null); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  },

  /**
   * PHASE PILOT-50-E/§10: البحث بالاسم يُستخدَم **فقط** لاكتشاف تعارض
   * محتمل (name_conflict_different_sender) — **لا** لمنح ثقة. يُعيد أول
   * سجل موثوق بهذا الاسم إن وُجد (باستثناء fingerprint المُستثنى، إن
   * أُعطي، لتفادي اعتبار السجل نفسه تعارضًا مع ذاته).
   */
  async findApprovedByDisplayName(displayName: string, excludeFingerprint?: string): Promise<TrustedTeacherSender | null> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(TRUSTED_SENDERS_STORE, "readonly").objectStore(TRUSTED_SENDERS_STORE).getAll();
      request.onsuccess = () => {
        database.close();
        const all = request.result as TrustedTeacherSender[];
        const match = all.find((s) => s.approvedDisplayName === displayName && s.fingerprint !== excludeFingerprint);
        resolve(match ?? null);
      };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  },

  /**
   * اعتماد صريح فقط — يُستدعى حصرًا بعد فعل يدوي واضح من المدير
   * ("اعتماد هذا المُرسِل" / "اعتماد الهوية الجديدة"). **لا يحذف أو
   * يستبدل أي سجل ثقة سابق لفينجربرنت مختلف** — كل fingerprint سجل
   * مستقل بذاته، صفر استبدال صامت (PHASE PILOT-50-F/§10).
   *
   * PHASE PILOT-50-F1: صفر اتصال IndexedDB يُفتَح قبل الحاجة الفعلية له.
   * getByFingerprint تفتح/تُغلِق اتصالها الخاص بذاتها بالكامل أولًا؛ اتصال
   * الكتابة يُفتَح فقط بعدها، لحظة الحاجة الفعلية، ويُغلَق دائمًا (نجاحًا
   * أو فشلًا) داخل نفس الـPromise التي فتحته.
   */
  async approveSender(input: { fingerprint: string; publicKeyJwk: JsonWebKey; approvedDisplayName: string; approvedStage: string }): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.getByFingerprint(input.fingerprint);
    const record: TrustedTeacherSender = {
      fingerprint: input.fingerprint,
      publicKeyJwk: input.publicKeyJwk,
      approvedDisplayName: input.approvedDisplayName,
      approvedStage: input.approvedStage,
      firstApprovedAt: existing?.firstApprovedAt ?? now,
      lastSeenAt: now,
    };
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TRUSTED_SENDERS_STORE, "readwrite");
      transaction.objectStore(TRUSTED_SENDERS_STORE).put(record);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  },

  /**
   * يُحدِّث lastSeenAt فقط لمُرسِل موثوق بالفعل — لا يُنشئ سجلًا جديدًا.
   *
   * PHASE PILOT-50-F1: نفس مبدأ approveSender أعلاه — getByFingerprint
   * أولًا (اتصال ذاتي مُغلَق بالكامل بحلول عودتها)، ثم اتصال كتابة جديد
   * **فقط إن existing فعليًا** — مسار "غير موجود" لا يفتح أي اتصال إطلاقًا
   * الآن (صفر تسريب ممكن بنيويًا، لا حتى نظريًا).
   */
  async touchLastSeen(fingerprint: string): Promise<void> {
    const existing = await this.getByFingerprint(fingerprint);
    if (!existing) return; // صفر اتصال فُتِح في هذا المسار إطلاقًا — صفر شيء لإغلاقه
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(TRUSTED_SENDERS_STORE, "readwrite");
      transaction.objectStore(TRUSTED_SENDERS_STORE).put({ ...existing, lastSeenAt: new Date().toISOString() });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  },

  /** PHASE PILOT-50-F/§12: كشف إعادة الإرسال — إعلامي فقط، صفر منع. */
  async hasSeenExportId(exportId: string): Promise<boolean> {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SEEN_EXPORT_IDS_STORE, "readonly").objectStore(SEEN_EXPORT_IDS_STORE).get(exportId);
      request.onsuccess = () => { database.close(); resolve(!!request.result); };
      request.onerror = () => { database.close(); reject(request.error); };
    });
  },

  async markExportIdSeen(exportId: string): Promise<void> {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SEEN_EXPORT_IDS_STORE, "readwrite");
      transaction.objectStore(SEEN_EXPORT_IDS_STORE).put({ exportId, seenAt: new Date().toISOString() });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    });
  },
};
