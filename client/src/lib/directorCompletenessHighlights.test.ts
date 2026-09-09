import { describe, expect, it } from "vitest";

/**
 * PHASE ID-4B: يختبر الخوارزمية الحرفية المُضمَّنة في Director.tsx لحساب
 * "أهم النواقص" (incomplete أولًا ثم needs_review، complete مُستبعَد) —
 * نسخة معزولة تطابق تمامًا كتلة الـIIFE الفعلية في JSX، لإثبات صحة المنطق
 * دون الحاجة لتشغيل مكوّن React كامل.
 */

type CompletenessStatus = "incomplete" | "needs_review" | "complete";
type Area = { id: string; label: string; status: CompletenessStatus };

const computeHighlights = (performanceAreas: Area[]): Area[] => [
  ...performanceAreas.filter((area) => area.status === "incomplete"),
  ...performanceAreas.filter((area) => area.status === "needs_review"),
];

const area = (id: string, label: string, status: CompletenessStatus): Area => ({ id, label, status });

describe("ID-4B — منطق أهم النواقص (incomplete ثم needs_review، complete مُستبعَد)", () => {
  it("1) كل المجالات complete -> قائمة فارغة", () => {
    expect(computeHighlights([area("1", "أ", "complete"), area("2", "ب", "complete")])).toEqual([]);
  });

  it("2) incomplete واحد -> يظهر", () => {
    const result = computeHighlights([area("1", "التخطيط", "incomplete"), area("2", "ب", "complete")]);
    expect(result).toEqual([area("1", "التخطيط", "incomplete")]);
  });

  it("3) عدة incomplete -> كلها تظهر بالترتيب الأصلي", () => {
    const result = computeHighlights([area("1", "أ", "incomplete"), area("2", "ب", "incomplete"), area("3", "ج", "complete")]);
    expect(result.map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("4) needs_review فقط -> تظهر", () => {
    const result = computeHighlights([area("1", "أ", "needs_review")]);
    expect(result).toEqual([area("1", "أ", "needs_review")]);
  });

  it("5) خليط -> incomplete قبل needs_review دائمًا بصرف النظر عن الترتيب الأصلي", () => {
    const result = computeHighlights([area("1", "أ", "needs_review"), area("2", "ب", "incomplete"), area("3", "ج", "complete"), area("4", "د", "incomplete")]);
    expect(result.map((a) => a.id)).toEqual(["2", "4", "1"]);
  });

  it("6) complete لا يظهر إطلاقًا في أهم النواقص", () => {
    const result = computeHighlights([area("1", "أ", "complete"), area("2", "ب", "complete"), area("3", "ج", "complete")]);
    expect(result.some((a) => a.status === "complete")).toBe(false);
  });

  it("7) القائمة الأصلية (performanceAreas) تبقى كل المجالات كما هي — الفلترة إنتاجية جديدة فقط، لا تُعدِّل المصدر", () => {
    const original = [area("1", "أ", "complete"), area("2", "ب", "incomplete")];
    computeHighlights(original);
    expect(original.length).toBe(2);
  });

  it("9) أسماء عربية طويلة لا تُفقَد أو تُقطَع في الفلترة", () => {
    const longLabel = "التخطيط للدروس وإعداد الأنشطة الصفية واللاصفية المتنوعة للطلاب والطالبات";
    const result = computeHighlights([area("1", longLabel, "incomplete")]);
    expect(result[0].label).toBe(longLabel);
  });
});
