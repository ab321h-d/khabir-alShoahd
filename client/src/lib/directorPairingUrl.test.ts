// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDirectorPairingUrl, parsePairingHashFromLocation, clearPairingHashFromLocation } from "./directorPairingUrl";

const setLocation = (pathname: string, hash = "") => {
  window.history.replaceState(null, "", `${pathname}${hash}`);
};

beforeEach(() => { setLocation("/"); });
afterEach(() => { setLocation("/"); });

describe("PHASE NEXT-2D-D-C-FIX1: directorPairingUrl — التوجيه الحقيقي لجذر المعلم", () => {
  it("1) عند فتح المولِّد من مسار المدير، الرابط الناتج يستهدف جذر المعلم لا /director", () => {
    setLocation("/director");
    const url = buildDirectorPairingUrl("sample-token");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(import.meta.env.BASE_URL);
  });

  it("2) المسار الناتج لا يحتفظ بـ/director تحت أي ظرف", () => {
    setLocation("/director");
    const url = buildDirectorPairingUrl("sample-token");
    expect(new URL(url).pathname).not.toBe("/director");
    expect(new URL(url).pathname).not.toContain("/director");
  });

  it("3) نفس مسار الأساس (base path) الفعلي للنشر يُحترَم — لا افتراض جذر مطلق \"/\" ثابت يكسر نشر GitHub Pages/subpath", () => {
    setLocation("/director");
    const url = buildDirectorPairingUrl("sample-token");
    // القيمة الفعلية تساوي BASE_URL المُهيَّأة فعليًا وقت البناء — مرن مع أي إعداد نشر مستقبلي
    expect(new URL(url).pathname).toBe(import.meta.env.BASE_URL);
  });

  it("4) الرابط الناتج من مسار المعلم نفسه (/) يبقى صحيحًا بنفس المنطق", () => {
    setLocation("/");
    const url = buildDirectorPairingUrl("sample-token");
    expect(new URL(url).pathname).toBe(import.meta.env.BASE_URL);
  });

  it("8) صفر query string في الرابط الناتج", () => {
    setLocation("/director");
    const url = buildDirectorPairingUrl("sample-token");
    expect(new URL(url).search).toBe("");
  });

  it("hash يبقى #pair-director=<token> بصرف النظر عن مسار التوليد", () => {
    setLocation("/director");
    const url = buildDirectorPairingUrl("token-abc-123");
    expect(new URL(url).hash).toBe("#pair-director=token-abc-123");
  });
});

describe("PHASE NEXT-2D-D-C-FIX2: تمييز none/token/malformed", () => {
  it("4b) توكن صالح: parsePairingHashFromLocation يُعيد kind='token' بالقيمة الصحيحة", () => {
    setLocation("/", "#pair-director=valid-token-xyz");
    const result = parsePairingHashFromLocation();
    expect(result).toEqual({ kind: "token", token: "valid-token-xyz" });
  });

  it("5) hash اقتران فارغ (#pair-director=) يُصنَّف malformed، لا none", () => {
    setLocation("/", "#pair-director=");
    const result = parsePairingHashFromLocation();
    expect(result.kind).toBe("malformed");
  });

  it("6) hash malformed قابل للتنظيف فعليًا (الخلل السابق: كان يُمنَع من التنظيف)", () => {
    setLocation("/", "#pair-director=");
    expect(parsePairingHashFromLocation().kind).toBe("malformed");
    clearPairingHashFromLocation();
    expect(parsePairingHashFromLocation().kind).toBe("none");
    expect(window.location.hash).toBe("");
  });

  it("7) hash غير ذي صلة (مثل collaborationInvite.ts) يبقى kind='none'، ولا يُلمَس عند التنظيف", () => {
    setLocation("/", "#invite=unrelated-token");
    expect(parsePairingHashFromLocation().kind).toBe("none");
    clearPairingHashFromLocation();
    expect(window.location.hash).toBe("#invite=unrelated-token"); // لم يُلمَس إطلاقًا
  });

  it("صفر hash إطلاقًا يُعيد kind='none'", () => {
    setLocation("/", "");
    expect(parsePairingHashFromLocation().kind).toBe("none");
  });

  it("round trip حقيقي: بناء الرابط ثم قراءة hash من location يُعيد نفس التوكن بالضبط", () => {
    const token = "roundtrip-test-token-xyz789";
    const url = buildDirectorPairingUrl(token);
    setLocation(new URL(url).pathname, new URL(url).hash);
    const result = parsePairingHashFromLocation();
    expect(result).toEqual({ kind: "token", token });
  });
});

describe("PHASE NEXT-2D-D-C-FIX2: استمرارية النية عبر sessionStorage — تنجو من onboarding", () => {
  beforeEach(() => { window.sessionStorage.clear(); });
  afterEach(() => { window.sessionStorage.clear(); });

  it("2) capturePendingPairingIntent تحفظ النية، consumePendingPairingIntent تُعيدها حتى بعد مسح الـhash (محاكاة فقدان hash أثناء onboarding)", async () => {
    const { capturePendingPairingIntent, consumePendingPairingIntent } = await import("./directorPairingUrl");
    setLocation("/", "#pair-director=survives-onboarding-token");
    capturePendingPairingIntent();
    setLocation("/", "");
    const result = consumePendingPairingIntent();
    expect(result).toEqual({ kind: "token", token: "survives-onboarding-token" });
  });

  it("3) consumePendingPairingIntent تسقط لقراءة hash المباشر لو لا نية محفوظة (المعلم المُهيَّأ بالفعل، تدفق عادي)", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.clear();
    setLocation("/", "#pair-director=direct-hash-token");
    const result = consumePendingPairingIntent();
    expect(result).toEqual({ kind: "token", token: "direct-hash-token" });
  });

  it("hash malformed أيضًا يُلتقَط وينجو عبر sessionStorage", async () => {
    const { capturePendingPairingIntent, consumePendingPairingIntent } = await import("./directorPairingUrl");
    setLocation("/", "#pair-director=");
    capturePendingPairingIntent();
    setLocation("/", "");
    expect(consumePendingPairingIntent().kind).toBe("malformed");
  });

  it("6) clearPendingPairingIntent تمسح كلا sessionStorage والـhash معًا", async () => {
    const { capturePendingPairingIntent, consumePendingPairingIntent, clearPendingPairingIntent } = await import("./directorPairingUrl");
    setLocation("/", "#pair-director=to-be-cleared");
    capturePendingPairingIntent();
    clearPendingPairingIntent();
    expect(window.sessionStorage.getItem("khabir-pending-director-pairing")).toBeNull();
    setLocation("/", "");
    expect(consumePendingPairingIntent().kind).toBe("none");
  });

  it("8) hash غير ذي صلة لا يُلتقَط في sessionStorage إطلاقًا (صفر تدخل مع collaborationInvite.ts)", async () => {
    const { capturePendingPairingIntent } = await import("./directorPairingUrl");
    setLocation("/", "#invite=unrelated-collaboration-token");
    capturePendingPairingIntent();
    expect(window.sessionStorage.getItem("khabir-pending-director-pairing")).toBeNull();
  });
});

describe("PHASE NEXT-2D-D-C-FIX2.1: تحقق runtime من بيانات sessionStorage المُخزَّنة — صفر ثقة بالنوع وحده", () => {
  const STORAGE_KEY = "khabir-pending-director-pairing";
  beforeEach(() => { window.sessionStorage.clear(); });
  afterEach(() => { window.sessionStorage.clear(); });

  it("1) توكن مُخزَّن صالح يُقبَل", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "token", token: "valid-stored-token" }));
    expect(consumePendingPairingIntent()).toEqual({ kind: "token", token: "valid-stored-token" });
  });

  it("2) malformed مُخزَّنة صالحة تُقبَل", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "malformed" }));
    expect(consumePendingPairingIntent()).toEqual({ kind: "malformed" });
  });

  it("3) JSON غير صالح يُرفَض ويُزال، صفر استثناء يتسرَّب", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.setItem(STORAGE_KEY, "{not-valid-json!!!");
    setLocation("/", "");
    expect(() => consumePendingPairingIntent()).not.toThrow();
    expect(consumePendingPairingIntent().kind).toBe("none");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("4) kind غير معروف يُرفَض ويُزال", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "authorized" }));
    setLocation("/", "");
    expect(consumePendingPairingIntent().kind).toBe("none");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("5) token مفقود/غير نصي/فارغ يُرفَض ويُزال (ثلاث حالات)", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    setLocation("/", "");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "token" })); // مفقود
    expect(consumePendingPairingIntent().kind).toBe("none");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "token", token: 12345 })); // غير نصي
    expect(consumePendingPairingIntent().kind).toBe("none");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "token", token: "" })); // فارغ
    expect(consumePendingPairingIntent().kind).toBe("none");
  });

  it("null/مصفوفة مُخزَّنة تُرفَض أيضًا", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    setLocation("/", "");
    window.sessionStorage.setItem(STORAGE_KEY, "null");
    expect(consumePendingPairingIntent().kind).toBe("none");
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(["token", "x"]));
    expect(consumePendingPairingIntent().kind).toBe("none");
  });

  it("6) بعد بيانات مُخزَّنة تالفة، hash حالي صالح لا يزال يُقرَأ فعليًا (سقوط احتياطي يعمل)", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.setItem(STORAGE_KEY, "{corrupted");
    setLocation("/", "#pair-director=fallback-works-token");
    expect(consumePendingPairingIntent()).toEqual({ kind: "token", token: "fallback-works-token" });
  });

  it("7) hash حالي غير ذي صلة يبقى بلا لمس حتى مع بيانات مُخزَّنة تالفة", async () => {
    const { consumePendingPairingIntent } = await import("./directorPairingUrl");
    window.sessionStorage.setItem(STORAGE_KEY, "{corrupted");
    setLocation("/", "#invite=unrelated-token");
    expect(consumePendingPairingIntent().kind).toBe("none");
    expect(window.location.hash).toBe("#invite=unrelated-token");
  });

  it("8) صفر أي ذكر/استدعاء لـpairRecipient أو trust registry في هذا المسار (فحص بنيوي)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorPairingUrl.ts"), "utf-8");
    expect(source).not.toContain("pairRecipient(");
    expect(source).not.toContain("directorTrustRegistry");
  });
});
