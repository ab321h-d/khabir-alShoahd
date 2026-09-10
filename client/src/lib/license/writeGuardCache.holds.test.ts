import { beforeEach, describe, expect, it } from "vitest";
import { acquireWriteDenyHold, isWriteAllowedSync, releaseWriteDenyHold, resetWriteGuardCacheForTests, setCachedWriteStatus } from "./writeGuardCache";

beforeEach(() => resetWriteGuardCacheForTests());

describe("writeGuardCache — آلية الاحتجاز الصلبة (LIC-6C.1-FIX6)", () => {
  it("احتجاز نشط يمنع الكتابة حتى لو كان الكاش المثبَت true", () => {
    setCachedWriteStatus("teacher", true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
    acquireWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(false);
  });

  it("تحرير الاحتجاز الوحيد يُعيد كشف الكاش المثبَت الحقيقي", () => {
    setCachedWriteStatus("teacher", true);
    acquireWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    releaseWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("احتجازان متداخلان: تحرير الأول فقط لا يكفي — الثاني لا يزال يمنع الكتابة", () => {
    setCachedWriteStatus("teacher", true);
    acquireWriteDenyHold("hold-1");
    acquireWriteDenyHold("hold-2");
    releaseWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    releaseWriteDenyHold("hold-2");
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("acquireWriteDenyHold idempotent — نفس المعرّف مرتين لا يُنشئ احتجازين يحتاجان تحريرين", () => {
    setCachedWriteStatus("teacher", true);
    acquireWriteDenyHold("hold-1");
    acquireWriteDenyHold("hold-1");
    releaseWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("releaseWriteDenyHold لمعرّف غير موجود لا يفعل شيئًا، بلا خطأ", () => {
    expect(() => releaseWriteDenyHold("never-acquired")).not.toThrow();
  });

  it("resetWriteGuardCacheForTests يمسح كل الاحتجازات أيضًا", () => {
    setCachedWriteStatus("teacher", true);
    acquireWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    resetWriteGuardCacheForTests();
    setCachedWriteStatus("teacher", true);
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("احتجاز نشط يمنع الكتابة حتى مع تحديث الكاش لاحقًا أثناء نشاط الاحتجاز (محاكاة نافذة عابرة)", () => {
    acquireWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(false);
    setCachedWriteStatus("teacher", true); // getCurrentLicenseStatus تُحدِّث الكاش المثبَت داخليًا
    expect(isWriteAllowedSync("teacher")).toBe(false); // الاحتجاز لا يزال نشطًا — صفر نافذة عابرة
    releaseWriteDenyHold("hold-1");
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });
});
