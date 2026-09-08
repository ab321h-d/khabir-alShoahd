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

const databaseName = "khabir-identity-local";
const storeName = "identities";
const databaseVersion = 1;

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
    if (!database.objectStoreNames.contains(storeName)) {
      const store = database.createObjectStore(storeName, { keyPath: "userId" });
      store.createIndex("byScope", ["schoolId", "stage"], { unique: false });
      store.createIndex("byRole", "role", { unique: false });
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

  async getIdentityById(userId: string): Promise<UserIdentity | null> {
    const database = await openDatabase();
    const result = await closeWhenDone(database, requestValue(database.transaction(storeName, "readonly").objectStore(storeName).get(userId)));
    return (result as UserIdentity | undefined) || null;
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
};
