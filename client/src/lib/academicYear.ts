/**
 * Uses the device calendar only to suggest a Hijri year for a new local draft.
 * A user-entered value always takes precedence and is never overwritten.
 */
export const getSuggestedHijriYear = (date = new Date()): string => {
  try {
    const part = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { year: "numeric" })
      .formatToParts(date)
      .find((item) => item.type === "year")?.value;
    const numericYear = Number(part?.replace(/[^0-9]/g, ""));
    if (!Number.isInteger(numericYear) || numericYear < 1) return "";
    return new Intl.NumberFormat("ar-SA-u-nu-arab", { useGrouping: false }).format(numericYear);
  } catch {
    return "";
  }
};
