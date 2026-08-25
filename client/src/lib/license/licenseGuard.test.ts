import { beforeEach, describe, expect, it } from "vitest";
import { LicenseRestrictedError, assertWriteAllowedSync, isWriteAllowedSync } from "./licenseGuard";
import { resetWriteGuardCacheForTests, setCachedWriteStatus } from "./writeGuardCache";

describe("assertWriteAllowedSync — محاكاة Trial", () => {
  beforeEach(() => resetWriteGuardCacheForTests());

  it("Trial نشطة → الكتابة مسموحة", () => {
    setCachedWriteStatus("teacher", true);
    expect(() => assertWriteAllowedSync("teacher")).not.toThrow();
  });

  it("Trial منتهية → الكتابة مرفوضة برمي LicenseRestrictedError", () => {
    setCachedWriteStatus("teacher", false);
    expect(() => assertWriteAllowedSync("teacher")).toThrow(LicenseRestrictedError);
  });
});

describe("assertWriteAllowedSync — محاكاة ترخيص مدفوع", () => {
  beforeEach(() => resetWriteGuardCacheForTests());

  it("ترخيص مدفوع نشط → الكتابة مسموحة", () => {
    setCachedWriteStatus("director", true);
    expect(() => assertWriteAllowedSync("director")).not.toThrow();
  });

  it("ترخيص مدفوع منتهٍ → الكتابة مرفوضة", () => {
    setCachedWriteStatus("director", false);
    expect(() => assertWriteAllowedSync("director")).toThrow(LicenseRestrictedError);
  });
});

describe("حراسة المعلم والمدير منفصلتان", () => {
  beforeEach(() => resetWriteGuardCacheForTests());

  it("حظر نسخة المعلم لا يحظر نسخة المدير التي لم تُفحص بعد", () => {
    setCachedWriteStatus("teacher", false);
    expect(isWriteAllowedSync("teacher")).toBe(false);
    expect(isWriteAllowedSync("director")).toBe(true);
  });
});

describe("رسالة الخطأ", () => {
  beforeEach(() => resetWriteGuardCacheForTests());

  it("LicenseRestrictedError تحمل رسالة عربية واضحة", () => {
    setCachedWriteStatus("teacher", false);
    try {
      assertWriteAllowedSync("teacher");
      throw new Error("كان يجب أن يُرمى استثناء");
    } catch (error) {
      expect(error).toBeInstanceOf(LicenseRestrictedError);
      expect((error as Error).message).toContain("انتهت");
    }
  });
});
