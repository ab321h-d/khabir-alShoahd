// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateCanonical16ByteToken, generateCanonical32ByteToken } from "./relayUploadCapabilityCrypto";
import {
  buildDeliverySessionUrl,
  parseDeliveryHashFromLocation,
  clearDeliveryHashFromLocation,
  capturePendingDeliveryIntent,
  consumePendingDeliveryIntent,
  clearPendingDeliveryIntent,
  ensurePendingDeliveryAttemptId,
  recordResolvedDeliveryIdentity,
} from "./directorDeliverySessionUrl";

const setLocation = (pathname: string, hash = "") => {
  window.history.replaceState(null, "", `${pathname}${hash}`);
};

const STORAGE_KEY = "khabir-pending-relay-delivery";
beforeEach(() => { setLocation("/"); window.sessionStorage.clear(); });
afterEach(() => { setLocation("/"); window.sessionStorage.clear(); });

describe("PHASE NEXT-2E-B2-A2-B: directorDeliverySessionUrl — parsing صارم", () => {
  it("F) رابط صالح: بناء ثم قراءة يُعيد نفس المكوّنات الثلاثة بالضبط", () => {
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const capabilitySecret = generateCanonical32ByteToken();
    const url = buildDeliverySessionUrl(sessionId, deliveryProof, capabilitySecret);
    setLocation(new URL(url).pathname, new URL(url).hash);

    const result = parseDeliveryHashFromLocation();
    expect(result).toEqual({ kind: "intent", intent: { sessionId, deliveryProof, capabilitySecret }, redemptionAttemptId: null, resolvedIdentity: null });
  });

  it("F) صفر query string في الرابط الناتج — الحمولة في hash فقط", () => {
    const url = buildDeliverySessionUrl(generateCanonical16ByteToken(), generateCanonical32ByteToken(), generateCanonical32ByteToken());
    expect(new URL(url).search).toBe("");
  });

  it("F) مكوّن ناقص (2 بدل 3) -> malformed", () => {
    setLocation("/", `#deliver=${generateCanonical16ByteToken()}.${generateCanonical32ByteToken()}`);
    expect(parseDeliveryHashFromLocation().kind).toBe("malformed");
  });

  it("F) مكوّن زائد (4 بدل 3) -> malformed", () => {
    setLocation("/", `#deliver=${generateCanonical16ByteToken()}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}.extra`);
    expect(parseDeliveryHashFromLocation().kind).toBe("malformed");
  });

  it("F) طول خاطئ لأي مكوّن (sessionId بطول deliveryProof) -> malformed", () => {
    setLocation("/", `#deliver=${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`); // sessionId يجب أن يكون 22 حرفًا لا 43
    expect(parseDeliveryHashFromLocation().kind).toBe("malformed");
  });

  it("F) hash فارغ (#deliver=) -> malformed، لا none", () => {
    setLocation("/", "#deliver=");
    expect(parseDeliveryHashFromLocation().kind).toBe("malformed");
  });

  it("F) hash غير ذي صلة (مثل pair-director) -> none تمامًا، صفر تداخل", () => {
    setLocation("/", "#pair-director=some-unrelated-token");
    expect(parseDeliveryHashFromLocation().kind).toBe("none");
  });

  it("F) صفر hash إطلاقًا -> none", () => {
    setLocation("/", "");
    expect(parseDeliveryHashFromLocation().kind).toBe("none");
  });

  it("F) clear لا يُلمِس hash غير ذي صلة (pair-director يبقى كما هو)", () => {
    setLocation("/", "#pair-director=unrelated-token-xyz");
    clearDeliveryHashFromLocation();
    expect(window.location.hash).toBe("#pair-director=unrelated-token-xyz");
  });

  it("F) clear يُزيل #deliver فعليًا", () => {
    const url = buildDeliverySessionUrl(generateCanonical16ByteToken(), generateCanonical32ByteToken(), generateCanonical32ByteToken());
    setLocation(new URL(url).pathname, new URL(url).hash);
    clearDeliveryHashFromLocation();
    expect(window.location.hash).toBe("");
  });
});

describe("PHASE NEXT-2E-B2-A2-B: استمرارية النية عبر onboarding — مستقلة تمامًا عن نية الاقتران", () => {
  it("G) النية تنجو من فقد hash (محاكاة onboarding طويل، نفس آلية FIX2)", () => {
    const sessionId = generateCanonical16ByteToken();
    const deliveryProof = generateCanonical32ByteToken();
    const capabilitySecret = generateCanonical32ByteToken();
    setLocation("/", `#deliver=${sessionId}.${deliveryProof}.${capabilitySecret}`);
    capturePendingDeliveryIntent();
    setLocation("/", ""); // الـhash اختفى أثناء onboarding

    const result = consumePendingDeliveryIntent();
    expect(result).toEqual({ kind: "intent", intent: { sessionId, deliveryProof, capabilitySecret }, redemptionAttemptId: null, resolvedIdentity: null });
  });

  it("مفتاح sessionStorage مستقل تمامًا عن مفتاح نية الاقتران", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    expect(window.sessionStorage.getItem("khabir-pending-director-pairing")).toBeNull(); // صفر تسريب لمفتاح الاقتران
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("بيانات sessionStorage مُخزَّنة تالفة تُرفَض وتُزال، سقوط احتياطي لقراءة hash المباشر", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "{corrupted-json");
    setLocation("/", "");
    expect(consumePendingDeliveryIntent().kind).toBe("none");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearPendingDeliveryIntent يمسح كلا sessionStorage والـhash معًا", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    clearPendingDeliveryIntent();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    setLocation("/", "");
    expect(consumePendingDeliveryIntent().kind).toBe("none");
  });

  it("G) صفر auto-redeem — فحص بنيوي: هذا الملف صفر استدعاء فعلي لـfetch إطلاقًا (parsing/storage فقط، التعليقات التوثيقية وأسماء الدوال الشرعية لا تُحتسَب)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorDeliverySessionUrl.ts"), "utf-8");
    expect(source).not.toContain("fetch(");
  });
});

describe("PHASE FRONTEND-REDEMPTION-RECOVERY: ensurePendingDeliveryAttemptId", () => {
  it("A/B) نية قديمة بلا attemptId -> يُنشئ واحدًا (16 بايت canonical، 22 حرفًا) ويُثبِّته في sessionStorage قبل أي استخدام", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();

    const before = consumePendingDeliveryIntent();
    expect(before.kind === "intent" && before.redemptionAttemptId).toBe(null);

    const attemptId = ensurePendingDeliveryAttemptId();
    expect(attemptId.length).toBe(22);
    expect(attemptId).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const after = consumePendingDeliveryIntent();
    expect(after.kind === "intent" && after.redemptionAttemptId).toBe(attemptId);
  });

  it("مرة واحدة فقط لكل نية — استدعاء ثانٍ يُعيد نفس attemptId بالضبط، صفر إعادة توليد", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();

    const first = ensurePendingDeliveryAttemptId();
    const second = ensurePendingDeliveryAttemptId();
    expect(second).toBe(first);
  });

  it("E) attemptId يبقى ثابتًا عبر محاكاة refresh (فقد hash، استمرار من sessionStorage فقط)", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    const attemptId = ensurePendingDeliveryAttemptId();

    setLocation("/", ""); // محاكاة refresh — الـhash اختفى
    const resumed = consumePendingDeliveryIntent();
    expect(resumed.kind === "intent" && resumed.redemptionAttemptId).toBe(attemptId);
    expect(ensurePendingDeliveryAttemptId()).toBe(attemptId); // نفس القيمة بالضبط، صفر توليد جديد
  });

  it("C) فشل كتابة sessionStorage يرمي صراحة — صفر إعادة قيمة صامتة", async () => {
    const { vi } = await import("vitest");
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();

    // vi.spyOn على Storage.prototype مباشرة — أكثر موثوقية عبر jsdom من
    // spyOn على instance window.sessionStorage نفسه في بعض إصدارات jsdom.
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("QuotaExceededError"); });
    try {
      expect(() => ensurePendingDeliveryAttemptId()).toThrow();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("صفر نية معلَّقة إطلاقًا -> يرمي بوضوح", () => {
    setLocation("/", "");
    expect(() => ensurePendingDeliveryAttemptId()).toThrow();
  });
});

describe("PHASE FRONTEND-REDEMPTION-RECOVERY: recordResolvedDeliveryIdentity", () => {
  it("§4) يُثبِّت resolvedIdentity في sessionStorage قبل أي حفظ محلي — يُقرَأ لاحقًا حتى بعد محاكاة refresh", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    const attemptId = ensurePendingDeliveryAttemptId();

    const recipientId = generateCanonical16ByteToken();
    const capabilityId = generateCanonical16ByteToken();
    recordResolvedDeliveryIdentity(sessionId, attemptId, { recipientId, capabilityId });

    setLocation("/", ""); // محاكاة refresh
    const resumed = consumePendingDeliveryIntent();
    expect(resumed.kind === "intent" && resumed.resolvedIdentity).toEqual({ recipientId, capabilityId });
  });

  it("§4/M) sessionId غير مطابق للنية المحفوظة -> يرمي، صفر كتابة (رفض آمن)", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    const attemptId = ensurePendingDeliveryAttemptId();

    expect(() => recordResolvedDeliveryIdentity("wrong-session-id-not-matching", attemptId, { recipientId: generateCanonical16ByteToken(), capabilityId: generateCanonical16ByteToken() })).toThrow();

    const after = consumePendingDeliveryIntent();
    expect(after.kind === "intent" && after.resolvedIdentity).toBe(null);
  });

  it("§4/M) attemptId غير مطابق -> يرمي، صفر كتابة", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    ensurePendingDeliveryAttemptId();

    expect(() => recordResolvedDeliveryIdentity(sessionId, "wrong-attempt-id-xx-not-matching", { recipientId: generateCanonical16ByteToken(), capabilityId: generateCanonical16ByteToken() })).toThrow();
  });

  it("M) resolvedIdentity مُشوَّهة في sessionStorage تُعامَل كـnull، صفر إفساد للنية الأساسية الصالحة", () => {
    const sessionId = generateCanonical16ByteToken();
    setLocation("/", `#deliver=${sessionId}.${generateCanonical32ByteToken()}.${generateCanonical32ByteToken()}`);
    capturePendingDeliveryIntent();
    const attemptId = ensurePendingDeliveryAttemptId();

    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) as string);
    stored.resolvedIdentity = { recipientId: "too-short", capabilityId: "also-too-short" }; // صيغة غير صالحة
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const result = consumePendingDeliveryIntent();
    expect(result.kind).toBe("intent");
    expect(result.kind === "intent" && result.resolvedIdentity).toBe(null); // رُفِضت بأمان
    expect(result.kind === "intent" && result.redemptionAttemptId).toBe(attemptId); // النية الأساسية سليمة
  });
});
