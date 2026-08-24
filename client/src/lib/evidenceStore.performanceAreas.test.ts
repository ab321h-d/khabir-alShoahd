import { describe, expect, it } from "vitest";
import { coverTemplateIds, createDefaultDraft, createDefaultPerformanceAreaLabels, createDefaultPerformanceAreas, defaultEvaluationEvidenceTemplate, isDefaultEvaluationEvidenceTemplate, performanceAreas, removeRetiredReflection, reorderPerformanceAreas } from "./evidenceStore";

describe("بنود الأداء المحلية", () => {
  it("تربط كل شاهد افتراضي ببند أداء معرّف", () => {
    const draft = createDefaultDraft();
    const areaIds = new Set(performanceAreas.map((area) => area.id));

    expect(draft.bundle.length).toBeGreaterThan(0);
    expect(draft.bundle.every((item) => areaIds.has(item.performanceArea))).toBe(true);
    expect(draft.period).toBe("للعام الدراسي");
  });

  it("يبدأ الغلاف بلون عنوان صالح للتخصيص والتصدير", () => {
    const draft = createDefaultDraft();

    expect(draft.coverTitleColor).toBe("#183D5A");
    expect(draft.showTeacherRole).toBe(true);
  });

  it("يوفر إطارًا ذهبيًا رسميًا ضمن خيارات الغلاف المحفوظة", () => {
    expect(coverTemplateIds).toContain("gold");
  });

  it("لا يضيف نص تأمل افتراضيًا إلى المخرجات", () => {
    const draft = createDefaultDraft();

    expect(draft.reflection).toBe("");
    expect(draft.includeReflection).toBe(false);
  });

  it("ينظف عبارة التأمل الافتراضية من المسودات المحلية القديمة", () => {
    const oldReflection = ["وثّقت مشاركتي في ورشة تدريبية", "طورت ممارساتي الصفية."].join(" ");

    expect(removeRetiredReflection(oldReflection)).toBe("");
  });

  it("تتضمن بنود الأداء الأساسية المرئية للمعلم", () => {
    expect(performanceAreas.map((area) => area.label)).toEqual(expect.arrayContaining([
      "إعداد وتنفيذ خطط التعلم",
      "الإدارة الصفية",
      "أداء الواجبات الوظيفية",
      "استراتيجيات التدريس",
      "توظيف تقنيات ووسائل التعلم المناسبة",
    ]));
  });

  it("تبدأ أسماء البنود قابلة للتخصيص من خريطة أسماء افتراضية كاملة", () => {
    const labels = createDefaultPerformanceAreaLabels();
    expect(labels.teaching_strategies).toBe("استراتيجيات التدريس");
    expect(Object.keys(labels)).toHaveLength(performanceAreas.length);
  });

  it("يحفظ تعريفات البنود الأساسية ضمن المسودة لتقبل إضافة بنود مخصصة", () => {
    const draft = createDefaultDraft();
    const areas = [...createDefaultPerformanceAreas(), { id: "custom-professional-growth", label: "النمو المهني" }];
    const labels = createDefaultPerformanceAreaLabels(areas);

    expect(draft.performanceAreas).toHaveLength(performanceAreas.length);
    expect(labels["custom-professional-growth"]).toBe("النمو المهني");
    expect(isDefaultEvaluationEvidenceTemplate(labels, areas)).toBe(false);
  });

  it("يعيد ترتيب بند محدد دون حذف أي بند أو تغيير بياناته", () => {
    const areas = createDefaultPerformanceAreas();
    const source = areas[3];
    const target = areas[0];
    const reordered = reorderPerformanceAreas(areas, source.id, target.id);

    expect(reordered[0]?.id).toBe(source.id);
    expect(reordered).toHaveLength(areas.length);
    expect(reordered.map((area) => area.id).sort()).toEqual(areas.map((area) => area.id).sort());
  });

  it("يوفر قالب شواهد التقييم الافتراضية جميع البنود دون إنشاء شواهد جديدة", () => {
    const draft = createDefaultDraft();
    expect(defaultEvaluationEvidenceTemplate.label).toBe("شواهد التقييم الافتراضية");
    expect(isDefaultEvaluationEvidenceTemplate(draft.performanceAreaLabels)).toBe(true);
    expect(draft.bundle).toHaveLength(3);
  });
});
