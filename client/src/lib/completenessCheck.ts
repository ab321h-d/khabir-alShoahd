/**
 * R-NEXT-2: مصدر الحقيقة الوحيد لمنطق "اكتمال" بند الأداء. هذا فحص اكتمال
 * فقط — وجود صورة لا يعني أنها مناسبة، ووجود شاهد لا يعني أنه جيد تربويًا.
 * لا تقييم لجودة المعلم أو الشاهد بأي شكل.
 *
 * القاعدة المقفلة:
 *   evidenceCount === 0                      → "incomplete"
 *   evidenceCount >= 1 && imageCount === 0    → "needs_review"
 *   evidenceCount >= 1 && imageCount >= 1     → "complete"
 */

export type CompletenessStatus = "incomplete" | "needs_review" | "complete";

export type CompletenessMetadata = {
  schemaVersion: 1;
  exportId: string;
  generatedAt: string;
  performanceAreas: Array<{
    id: string;
    label: string;
    evidenceCount: number;
    imageCount: number;
    status: CompletenessStatus;
  }>;
  totals: {
    areasCount: number;
    completeCount: number;
    needsReviewCount: number;
    incompleteCount: number;
  };
};

export const computeAreaStatus = (evidenceCount: number, imageCount: number): CompletenessStatus => {
  if (evidenceCount === 0) return "incomplete";
  if (imageCount === 0) return "needs_review";
  return "complete";
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isValidStatus = (value: unknown): value is CompletenessStatus =>
  value === "incomplete" || value === "needs_review" || value === "complete";

/**
 * تحقق كامل fail-closed من metadata واردة من ملف خارجي (حزمة مدير). أي فشل
 * في أي شرط يُعيد null — لا تخمين، لا انهيار. لا يعتمد على قيمة `status`
 * المُرسَلة وحدها؛ يُعيد حسابها من `evidenceCount`/`imageCount` ويقارنها.
 */
export const validateCompletenessMetadata = (raw: unknown): CompletenessMetadata | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const metadata = raw as Record<string, unknown>;

  if (metadata.schemaVersion !== 1) return null;
  if (typeof metadata.exportId !== "string" || metadata.exportId.length === 0) return null;
  if (typeof metadata.generatedAt !== "string" || Number.isNaN(new Date(metadata.generatedAt).getTime())) return null;
  if (!Array.isArray(metadata.performanceAreas)) return null;

  let completeCount = 0;
  let needsReviewCount = 0;
  let incompleteCount = 0;

  for (const rawArea of metadata.performanceAreas) {
    if (typeof rawArea !== "object" || rawArea === null) return null;
    const area = rawArea as Record<string, unknown>;
    if (typeof area.id !== "string" || typeof area.label !== "string") return null;
    if (!isNonNegativeInteger(area.evidenceCount) || !isNonNegativeInteger(area.imageCount)) return null;
    if (!isValidStatus(area.status)) return null;
    if (area.status !== computeAreaStatus(area.evidenceCount, area.imageCount)) return null;

    if (area.status === "complete") completeCount += 1;
    else if (area.status === "needs_review") needsReviewCount += 1;
    else incompleteCount += 1;
  }

  if (typeof metadata.totals !== "object" || metadata.totals === null) return null;
  const totals = metadata.totals as Record<string, unknown>;
  if (
    !isNonNegativeInteger(totals.areasCount) ||
    !isNonNegativeInteger(totals.completeCount) ||
    !isNonNegativeInteger(totals.needsReviewCount) ||
    !isNonNegativeInteger(totals.incompleteCount)
  ) return null;
  if (totals.areasCount !== metadata.performanceAreas.length) return null;
  if (totals.completeCount + totals.needsReviewCount + totals.incompleteCount !== totals.areasCount) return null;
  if (totals.completeCount !== completeCount || totals.needsReviewCount !== needsReviewCount || totals.incompleteCount !== incompleteCount) return null;

  return raw as CompletenessMetadata;
};
