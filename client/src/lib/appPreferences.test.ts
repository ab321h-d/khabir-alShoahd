import { beforeEach, describe, expect, it } from "vitest";
import { appAppearance, appProtection, appThemes, isValidAppPassword, isValidAppTheme } from "./appPreferences";

const memoryStorage = new Map<string, string>();

beforeEach(() => {
  memoryStorage.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
    getItem: (key: string) => memoryStorage.get(key) || null,
    setItem: (key: string, value: string) => memoryStorage.set(key, value),
    removeItem: (key: string) => memoryStorage.delete(key),
    },
    dispatchEvent: () => true,
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset: {} } } });
  appProtection.clearPassword();
  appAppearance.clearTheme();
});

describe("تفضيلات التطبيق المحلية", () => {
  it("تعرض سمات واجهة محددة وتحفظ الاختيار الصحيح", () => {
    expect(appThemes.map((theme) => theme.id)).toEqual(["petrol", "sage", "violet"]);
    expect(isValidAppTheme("sage")).toBe(true);
    expect(isValidAppTheme("غير معروف")).toBe(false);
    appAppearance.setTheme("violet");
    expect(appAppearance.getTheme()).toBe("violet");
  });

  it("تتحقق من الحد الأدنى لكلمة المرور", () => {
    expect(isValidAppPassword("12345")).toBe(false);
    expect(isValidAppPassword("123456")).toBe(true);
  });
});
