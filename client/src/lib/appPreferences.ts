export const appThemes = [
  { id: "petrol", label: "أزرق بترولي", note: "الهوية الحالية" },
  { id: "sage", label: "أخضر مريمي", note: "هادئ ومؤسسي" },
  { id: "violet", label: "بنفسجي متزن", note: "مميز وناعم" },
] as const;

export type AppThemeId = typeof appThemes[number]["id"];

type StoredPassword = { version: 1; salt: string; hash: string };

const themeStorageKey = "khabir-evidence-theme.v1";
const passwordStorageKey = "khabir-evidence-password.v1";
const lockEventName = "khabir-evidence-lock-change";
let unlockedForSession = false;

const toBase64 = (data: ArrayBuffer) => {
  const bytes = new Uint8Array(data);
  let text = "";
  bytes.forEach((value) => { text += String.fromCharCode(value); });
  return btoa(text);
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const storage = () => typeof window === "undefined" ? null : window.localStorage;

const readStoredPassword = (): StoredPassword | null => {
  try {
    const parsed = JSON.parse(storage()?.getItem(passwordStorageKey) || "null") as Partial<StoredPassword> | null;
    return parsed?.version === 1 && typeof parsed.salt === "string" && typeof parsed.hash === "string" ? parsed as StoredPassword : null;
  } catch {
    return null;
  }
};

const deriveHash = async (password: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const result = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new Uint8Array(salt), iterations: 180000, hash: "SHA-256" }, material, 256);
  return toBase64(result);
};

const notifyLockChange = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(lockEventName));
};

export const isValidAppTheme = (theme: string): theme is AppThemeId => appThemes.some((option) => option.id === theme);

export const isValidAppPassword = (password: string) => password.trim().length >= 6;

export const appAppearance = {
  getTheme(): AppThemeId {
    const saved = storage()?.getItem(themeStorageKey) || "petrol";
    return isValidAppTheme(saved) ? saved : "petrol";
  },

  applyTheme(theme: AppThemeId) {
    if (typeof document !== "undefined") document.documentElement.dataset.appTheme = theme;
  },

  applyStoredTheme() {
    const theme = this.getTheme();
    this.applyTheme(theme);
    return theme;
  },

  setTheme(theme: AppThemeId) {
    storage()?.setItem(themeStorageKey, theme);
    this.applyTheme(theme);
  },

  clearTheme() {
    storage()?.removeItem(themeStorageKey);
    if (typeof document !== "undefined") delete document.documentElement.dataset.appTheme;
  },
};

export const appProtection = {
  hasPassword: () => Boolean(readStoredPassword()),
  isUnlocked: () => unlockedForSession,

  async setPassword(password: string) {
    if (!isValidAppPassword(password)) throw new Error("استخدم كلمة مرور من 6 أحرف على الأقل");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await deriveHash(password, salt);
    storage()?.setItem(passwordStorageKey, JSON.stringify({ version: 1, salt: toBase64(salt.buffer), hash } satisfies StoredPassword));
    unlockedForSession = true;
    notifyLockChange();
  },

  async verify(password: string) {
    const stored = readStoredPassword();
    if (!stored) return true;
    const hash = await deriveHash(password, fromBase64(stored.salt));
    const accepted = hash === stored.hash;
    if (accepted) unlockedForSession = true;
    return accepted;
  },

  lockNow() {
    unlockedForSession = false;
    notifyLockChange();
  },

  clearPassword() {
    storage()?.removeItem(passwordStorageKey);
    unlockedForSession = true;
    notifyLockChange();
  },
};

export const appPreferenceKeys = { themeStorageKey, passwordStorageKey, lockEventName };
