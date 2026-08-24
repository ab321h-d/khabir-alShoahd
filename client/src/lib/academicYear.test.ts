import { describe, expect, it } from "vitest";
import { getSuggestedHijriYear } from "./academicYear";

describe("اقتراح العام الهجري", () => {
  it("يعيد سنة هجرية عربية من تقويم الجهاز دون نصوص إضافية", () => {
    expect(getSuggestedHijriYear(new Date("2026-08-21T12:00:00.000Z"))).toMatch(/^[٠-٩]{4}$/);
  });
});
