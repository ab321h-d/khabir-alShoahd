import { describe, expect, it } from "vitest";
import { addCalendarMonthsIso, computeTrialExpiryIso, resolveEffectiveNow } from "./trialDate";

describe("حساب الأشهر التقويمية", () => {
  it("يضيف 3 أشهر تقويمية لتاريخ عادي دون تغيير اليوم", () => {
    const expiry = computeTrialExpiryIso("2026-08-24T10:00:00.000Z");
    expect(expiry.slice(0, 10)).toBe("2026-11-24");
  });

  it("يثبّت اليوم على آخر يوم متاح عندما لا يوجد يوم مطابق في الشهر الهدف (31 يناير)", () => {
    const expiry = addCalendarMonthsIso("2026-01-31T00:00:00.000Z", 3);
    expect(expiry.slice(0, 10)).toBe("2026-04-30");
  });

  it("يعالج فبراير غير الكبيسة بشكل صحيح (30 نوفمبر + 3 أشهر)", () => {
    const expiry = addCalendarMonthsIso("2026-11-30T00:00:00.000Z", 3);
    expect(expiry.slice(0, 10)).toBe("2027-02-28");
  });

  it("يمر بحدود السنة بشكل صحيح (24 نوفمبر 2026 + 3 أشهر = 24 فبراير 2027)", () => {
    const expiry = addCalendarMonthsIso("2026-11-24T00:00:00.000Z", 3);
    expect(expiry.slice(0, 10)).toBe("2027-02-24");
  });

  it("يرمي خطأ واضحًا لتاريخ غير صالح", () => {
    expect(() => addCalendarMonthsIso("not-a-date", 3)).toThrow();
  });
});

describe("رصد تراجع ساعة الجهاز", () => {
  it("لا يعتبر فارقًا بسيطًا ضمن هامش التسامح تلاعبًا", () => {
    const result = resolveEffectiveNow("2026-08-24T09:58:00.000Z", "2026-08-24T10:00:00.000Z");
    expect(result.clockRollbackDetected).toBe(false);
  });

  it("يكتشف تراجعًا واضحًا في الساعة ويستخدم آخر وقت معروف بدلاً منه", () => {
    const lastSeen = "2026-08-24T10:00:00.000Z";
    const result = resolveEffectiveNow("2026-06-01T00:00:00.000Z", lastSeen);
    expect(result.clockRollbackDetected).toBe(true);
    expect(result.effectiveNowIso).toBe(lastSeen);
  });

  it("لا يتأثر إن لم يوجد وقت سابق معروف بعد", () => {
    const now = "2026-08-24T10:00:00.000Z";
    const result = resolveEffectiveNow(now, null);
    expect(result.clockRollbackDetected).toBe(false);
    expect(result.effectiveNowIso).toBe(now);
  });
});
