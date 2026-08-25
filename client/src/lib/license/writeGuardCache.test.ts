import { beforeEach, describe, expect, it } from "vitest";
import { isWriteAllowedSync, resetWriteGuardCacheForTests, setCachedWriteStatus } from "./writeGuardCache";

describe("ذاكرة الحراسة المتزامنة", () => {
  beforeEach(() => resetWriteGuardCacheForTests());

  it("متفائلة (تسمح) قبل أي تحديث للذاكرة", () => {
    expect(isWriteAllowedSync("teacher")).toBe(true);
    expect(isWriteAllowedSync("director")).toBe(true);
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

  it("حالة المعلم والمدير مستقلتان تمامًا في الذاكرة إن لم يُحدَّث أحدهما بعد", () => {
    setCachedWriteStatus("teacher", false);
    expect(isWriteAllowedSync("teacher")).toBe(false);
    expect(isWriteAllowedSync("director")).toBe(true);
  });
});
