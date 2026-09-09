import { beforeEach, describe, expect, it } from "vitest";
import { isWriteAllowedSync, resetWriteGuardCacheForTests, setCachedWriteStatus } from "./writeGuardCache";

describe("ذاكرة الحراسة المتزامنة", () => {
  beforeEach(() => resetWriteGuardCacheForTests());

  it("متشائمة/Fail-Closed — تمنع الكتابة لكلا النطاقين قبل أي تحديث للذاكرة", () => {
    expect(isWriteAllowedSync("teacher")).toBe(false);
    expect(isWriteAllowedSync("director")).toBe(false);
  });

  it("تعكس حالة المنع فور تحديثها لنطاق معيّن", () => {
    setCachedWriteStatus("teacher", false);
    expect(isWriteAllowedSync("teacher")).toBe(false);
  });

  it("تعكس حالة السماح فور تحديثها", () => {
    setCachedWriteStatus("teacher", false);
    setCachedWriteStatus("teacher", true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("حالة المعلم والمدير مستقلتان تمامًا: تفعيل أحدهما لا يُفعِّل الآخر غير المحمَّل بعد (يبقى denied، fail-closed)", () => {
    setCachedWriteStatus("teacher", true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
    expect(isWriteAllowedSync("director")).toBe(false);
  });
});
