/**
 * PHASE ID-1: طبقة هوية معزولة تمامًا — مدرسة/مرحلة/هوية مستخدم (معلم أو
 * مدير). Data/Foundation فقط: صفر PIN، صفر token، صفر واجهة مصادقة، صفر
 * ترحيل تلقائي لأي بيانات قديمة. مستقلة كليًا عن نظام الترخيص
 * (license/licenseGuard.ts, licenseStore.ts, writeGuardCache.ts) وعن
 * evidenceStore.ts/directorStore.ts — لا استيراد من أي منها، ولا استيراد
 * منها لهذا الملف.
 */

export type SchoolStage = "elementary" | "middle" | "secondary";

export type IdentityRole = "teacher" | "director";

export type IdentityStatus = "active" | "disabled";

export interface SchoolScope {
  schoolId: string;
  stage: SchoolStage;
}

export interface UserIdentity {
  userId: string;
  role: IdentityRole;
  schoolId: string;
  stage: SchoolStage;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  status: IdentityStatus;
}

export interface TeacherOnboardingIdentity {
  userId: string;
  role: "teacher";
  stage: SchoolStage;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  status: IdentityStatus;
}

export type StoredIdentity = UserIdentity | TeacherOnboardingIdentity;

const databaseName = "khabir-identity-local";
const storeName = "identities";
const credentialsStoreName = "directorCredentials";
const devicesStoreName = "trustedDevices";
const consumedActivationsStoreName = "consumedActivations";
const databaseVersion = 3;

export interface DirectorCredentialRecord {
  userId: string;
  salt: string;
  derivedHash: string;
  iterations: number;
  algorithmVersion: 1;
  failedAttempts: number;
  lockUntil: string | null; // ISO timestamp أو null
  updatedAt: string;
}

export interface TrustedDeviceRecord {
  deviceId: string;
  userId: string;
  registeredAt: string;
}

const validStages: readonly SchoolStage[] = ["elementary", "middle", "secondary"];
const validRoles: readonly IdentityRole[] = ["teacher", "director"];

/**
 * مفتاح نطاق ثابت (deterministic) — المصدر الوحيد لبناء مفتاح المدرسة/المرحلة
 * في كامل هذه الطبقة. لا يُبنى يدويًا في أي مكان آخر.
 */
export const getSchoolScopeKey = (scope: SchoolScope): string => `${scope.schoolId}::${scope.stage}`;

const generateUserId = (): string => crypto.randomUUID?.() || `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;

class IdentityValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityValidationError";
  }
}

const validateSchoolId = (schoolId: string): string => {
  const trimmed = schoolId.trim();
  if (!trimmed) throw new IdentityValidationError("schoolId فارغ");
  return trimmed;
};

const validateDisplayName = (displayName: string): string => {
  const trimmed = displayName.trim();
  if (!trimmed) throw new IdentityValidationError("displayName فارغ");
  return trimmed;
};

const validateStage = (stage: SchoolStage): SchoolStage => {
  if (!validStages.includes(stage)) throw new IdentityValidationError("stage غير صالح");
  return stage;
};

const validateRole = (role: IdentityRole): IdentityRole => {
  if (!validRoles.includes(role)) throw new IdentityValidationError("role غير صالح");
  return role;
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(databaseName, databaseVersion);
  request.onupgradeneeded = () => {
    const database = request.result;
    // PHASE ID-1: يُحافَظ عليه دائمًا — أي ترقية إصدار لاحقة لا تحذفه ولا تعيد إنشاءه.
    if (!database.objectStoreNames.contains(storeName)) {
      const store = database.createObjectStore(storeName, { keyPath: "userId" });
      store.createIndex("byScope", ["schoolId", "stage"], { unique: false });
      store.createIndex("byRole", "role", { unique: false });
    }
    // PHASE ID-2: مخازن جديدة إضافية فقط — لا تلمس store الهوية أعلاه.
    if (!database.objectStoreNames.contains(credentialsStoreName)) {
      database.createObjectStore(credentialsStoreName, { keyPath: "userId" });
    }
    if (!database.objectStoreNames.contains(devicesStoreName)) {
      const deviceStore = database.createObjectStore(devicesStoreName, { keyPath: "deviceId" });
      deviceStore.createIndex("byUser", "userId", { unique: false });
    }
    // PHASE ID-2A.1: مخزن إضافي فقط — تتبّع محلي لبيانات اعتماد تفعيل
    // استُهلِكت على هذا التثبيت، لمنع إعادة استخدامها محليًا (لا عبر أجهزة).
    if (!database.objectStoreNames.contains(consumedActivationsStoreName)) {
      database.createObjectStore(consumedActivationsStoreName, { keyPath: "activationId" });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const closeWhenDone = <T,>(database: IDBDatabase, value: Promise<T>) => value.finally(() => database.close());

const requestValue = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export const identityStore = {
  async createTeacherOnboardingIdentity(input: { stage: SchoolStage; displayName: string }): Promise<TeacherOnboardingIdentity> {
    const stage = validateStage(input.stage);
    const displayName = validateDisplayName(input.displayName);
    const now = new Date().toISOString();

    const identity: TeacherOnboardingIdentity = {
      userId: generateUserId(),
      role: "teacher",
      stage,
      displayName,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };

    const database = await openDatabase();
    await closeWhenDone(
      database,
      requestValue(
        database.transaction(storeName, "readwrite").objectStore(storeName).put(identity),
      ),
    );

    return identity;
  },

  async createIdentity(input: { role: IdentityRole; schoolId: string; stage: SchoolStage; displayName: string }): Promise<UserIdentity> {
    const role = validateRole(input.role);
    const schoolId = validateSchoolId(input.schoolId);
    const stage = validateStage(input.stage);
    const displayName = validateDisplayName(input.displayName);
    const now = new Date().toISOString();
    const identity: UserIdentity = {
      userId: generateUserId(),
      role,
      schoolId,
      stage,
      displayName,
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    const database = await openDatabase();
    await closeWhenDone(database, requestValue(database.transaction(storeName, "readwrite").objectStore(storeName).add(identity)));
    return identity;
  },

  async getIdentityById(userId: string): Promise<StoredIdentity | null> {
    const database = await openDatabase();
    const result = await closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).get(userId)));
    return (result as StoredIdentity | undefined) || null;
  },

  async getIdentitiesForScope(scope: SchoolScope): Promise<UserIdentity[]> {
    const database = await openDatabase();
    const all = await closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).getAll())) as UserIdentity[];
    return all.filter((identity) => identity.schoolId === scope.schoolId && identity.stage === scope.stage);
  },

  async getIdentitiesByRole(role: IdentityRole): Promise<UserIdentity[]> {
    const database = await openDatabase();
    const all = await closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).getAll())) as UserIdentity[];
    return all.filter((identity) => identity.role === role);
  },

  async updateIdentity(userId: string, patch: Partial<Pick<UserIdentity, "displayName">>): Promise<UserIdentity | null> {
    const database = await openDatabase();
    return closeWhenDone(database, (async () => {
      const store = database.transaction(storeName, "readwrite").objectStore(storeName);
      const existing = await requestValue(store.get(userId)) as UserIdentity | undefined;
      if (!existing) return null;
      const next: UserIdentity = {
        ...existing,
        displayName: patch.displayName !== undefined ? validateDisplayName(patch.displayName) : existing.displayName,
        updatedAt: new Date().toISOString(),
      };
      await requestValue(store.put(next));
      return next;
    })());
  },

  async disableIdentity(userId: string): Promise<UserIdentity | null> {
    const database = await openDatabase();
    return closeWhenDone(database, (async () => {
      const store = database.transaction(storeName, "readwrite").objectStore(storeName);
      const existing = await requestValue(store.get(userId)) as UserIdentity | undefined;
      if (!existing) return null;
      const next: UserIdentity = { ...existing, status: "disabled", updatedAt: new Date().toISOString() };
      await requestValue(store.put(next));
      return next;
    })());
  },

  // ===== PHASE ID-2: بيانات اعتماد PIN المدير + الأجهزة الموثوقة =====

  async getDirectorCredential(userId: string): Promise<DirectorCredentialRecord | null> {
    const database = await openDatabase();
    const result = await closeWhenDone(database, requestValue(database.transaction(credentialsStoreName, "readonly").objectStore(credentialsStoreName).get(userId)));
    return (result as DirectorCredentialRecord | undefined) || null;
  },

  async putDirectorCredential(record: DirectorCredentialRecord): Promise<void> {
    const database = await openDatabase();
    await closeWhenDone(database, requestValue(database.transaction(credentialsStoreName, "readwrite").objectStore(credentialsStoreName).put(record)));
  },

  async getTrustedDevice(deviceId: string): Promise<TrustedDeviceRecord | null> {
    const database = await openDatabase();
    const result = await closeWhenDone(database, requestValue(database.transaction(devicesStoreName, "readonly").objectStore(devicesStoreName).get(deviceId)));
    return (result as TrustedDeviceRecord | undefined) || null;
  },

  async registerTrustedDevice(deviceId: string, userId: string): Promise<TrustedDeviceRecord> {
    const record: TrustedDeviceRecord = { deviceId, userId, registeredAt: new Date().toISOString() };
    const database = await openDatabase();
    await closeWhenDone(database, requestValue(database.transaction(devicesStoreName, "readwrite").objectStore(devicesStoreName).put(record)));
    return record;
  },

  // ===== PHASE ID-2A.1: تتبّع استهلاك بيانات اعتماد التفعيل (محلي فقط) =====

  async isActivationConsumed(activationId: string): Promise<boolean> {
    const database = await openDatabase();
    const result = await closeWhenDone(database, requestValue(database.transaction(consumedActivationsStoreName, "readonly").objectStore(consumedActivationsStoreName).get(activationId)));
    return result !== undefined;
  },

  async markActivationConsumed(activationId: string): Promise<void> {
    const database = await openDatabase();
    await closeWhenDone(database, requestValue(database.transaction(consumedActivationsStoreName, "readwrite").objectStore(consumedActivationsStoreName).add({ activationId, consumedAt: new Date().toISOString() })));
  },
};
