declare const __KHABIR_APP_VARIANT__: "teacher" | "director" | "combined";

export const appVariant = __KHABIR_APP_VARIANT__;
export const isDirectorStandalone = appVariant === "director";
export const isTeacherStandalone = appVariant === "teacher";
