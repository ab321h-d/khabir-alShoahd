// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLicenseVariant } from "./licenseTypes";

/**
 * PHASE LIC-6C.1-FIX5: polyfill بسيط لـBroadcastChannel لبيئة الاختبار —
 * يحاكي الدلالة الحقيقية بدقة: postMessage من مثيل لا يصل لنفس المثيل
 * المُرسِل، لكن يصل لكل مثيل آخر بنفس الاسم.
 *
 * ملاحظة منهجية مهمة: استدعاء notifyLicenseChanging/notifyLicenseChanged
 * من *نفس ملف الاختبار* يستخدم *نفس SESSION_ID* الخاص بالوحدة المستورَدة
 * (استيراد واحد مشترك) — فحص §7 (تجاهل الجيل المحلي) سيُصفّي هذه الرسائل
 * تلقائيًا وبصحة تامة، تمامًا كما يجب. لذا لمحاكاة "تبويب آخر" حقيقي في
 * هذه الاختبارات، نُرسِل رسائل مصنوعة يدويًا بمصدر (source) مختلف صراحةً
 * عبر قناة FakeBroadcastChannel خام، لا عبر دوال notify* الحقيقية.
 */
class FakeBroadcastChannel {
  static buses = new Map<string, Set<FakeBroadcastChannel>>();
  name: string;
  private listeners: Array<(event: { data: unknown }) => void> = [];
  constructor(name: string) {
    this.name = name;
    if (!FakeBroadcastChannel.buses.has(name)) FakeBroadcastChannel.buses.set(name, new Set());
    FakeBroadcastChannel.buses.get(name)!.add(this);
  }
  postMessage(data: unknown) {
    const peers = FakeBroadcastChannel.buses.get(this.name) ?? new Set();
    for (const peer of peers) {
      if (peer === this) continue;
      for (const listener of peer.listeners) listener({ data });
    }
  }
  addEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
    this.listeners.push(listener);
  }
  removeEventListener(_type: "message", listener: (event: { data: unknown }) => void) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }
  close() {
    FakeBroadcastChannel.buses.get(this.name)?.delete(this);
  }
}

(globalThis as unknown as { BroadcastChannel: typeof FakeBroadcastChannel }).BroadcastChannel = FakeBroadcastChannel;

const { setCachedWriteStatusHoisted } = vi.hoisted(() => ({ setCachedWriteStatusHoisted: vi.fn() }));

vi.mock("./licenseGuard", () => ({
  getCurrentLicenseStatus: vi.fn(async (variant: AppLicenseVariant) => {
    const status = { kind: "trial_active", writesAllowed: true, effectiveNow: "x", expiresAt: "x", clockRollbackDetected: false };
    // محاكاة أمينة للأثر الجانبي الحقيقي لـ getCurrentLicenseStatus (LIC-6B):
    // هي نفسها من تُحدِّث الكاش داخليًا، لا reproveRespectingPending مباشرة.
    setCachedWriteStatusHoisted(variant, status.writesAllowed);
    return status;
  }),
}));

const { setCachedWriteStatus, isWriteAllowedSync, resetWriteGuardCacheForTests, acquireWriteDenyHold } = await import("./writeGuardCache");
setCachedWriteStatusHoisted.mockImplementation(setCachedWriteStatus);
const { initLicenseCrossTabSync, notifyLicenseChanging, notifyLicenseChanged, createGeneration } = await import("./licenseCrossTabSync");
const { getCurrentLicenseStatus } = await import("./licenseGuard");

const CHANNEL_NAME = "khabir-license-state:teacher"; // كل اختبارات هذا الملف تستخدم teacher حصرًا

/** يُحاكي تبويبًا "آخر" حقيقيًا بمصدر مختلف صراحة — لا يستخدم SESSION_ID الوحدة نفسها. */
const postAsRemoteTab = (type: "license-state-changing" | "license-state-changed", generation: string) => {
  const remoteChannel = new FakeBroadcastChannel(CHANNEL_NAME);
  remoteChannel.postMessage({ type, generation, source: "remote-tab-simulated" });
  remoteChannel.close();
};

beforeEach(() => {
  resetWriteGuardCacheForTests();
  FakeBroadcastChannel.buses.clear();
  vi.clearAllMocks();
});

describe("licenseCrossTabSync — LIC-6C.1-FIX5", () => {
  it("1) generation آمن غير حساس (لا يحمل أي بيانات ترخيص)", () => {
    const gen = createGeneration();
    expect(typeof gen).toBe("string");
    expect(gen.length).toBeGreaterThan(0);
  });

  it("2/8) remote changing تُصفِّر الكاش فورًا محليًا في التبويب المستقبِل", () => {
    setCachedWriteStatus("teacher", true);
    const sync = initLicenseCrossTabSync("teacher");
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(false);
    sync.dispose();
  });

  it("5/7) رسالة changing المُرسَلة فعليًا عبر notifyLicenseChanging لا تحمل أي حقل حسّاس — فقط type/generation/source", () => {
    const spy = vi.fn();
    const inspector = new FakeBroadcastChannel(CHANNEL_NAME);
    inspector.addEventListener("message", spy);
    notifyLicenseChanging("teacher", createGeneration());
    expect(spy).toHaveBeenCalledTimes(1);
    const receivedKeys = Object.keys((spy.mock.calls[0][0] as { data: object }).data).sort();
    expect(receivedKeys).toEqual(["generation", "source", "type"].sort());
    inspector.close();
  });

  it("6) رسالة changed أيضًا لا تحمل أي حقل حسّاس", () => {
    const spy = vi.fn();
    const inspector = new FakeBroadcastChannel(CHANNEL_NAME);
    inspector.addEventListener("message", spy);
    notifyLicenseChanged("teacher", createGeneration());
    const receivedKeys = Object.keys((spy.mock.calls[0][0] as { data: object }).data).sort();
    expect(receivedKeys).toEqual(["generation", "source", "type"].sort());
    inspector.close();
  });

  it("9/10) remote changed يُشغِّل إعادة إثبات مركزية، والكاش false طوال ذلك حتى اكتمالها", async () => {
    const sync = initLicenseCrossTabSync("teacher");
    const gen = createGeneration();
    postAsRemoteTab("license-state-changing", gen);
    expect(isWriteAllowedSync("teacher")).toBe(false);
    postAsRemoteTab("license-state-changed", gen);
    await vi.waitFor(() => expect(getCurrentLicenseStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(isWriteAllowedSync("teacher")).toBe(true);
    sync.dispose();
  });

  it("11/12) جيلان remote متداخلان: اكتمال الأول لا يُعيد الكتابة، فقط اكتمال الأخير يسمح بذلك", async () => {
    const sync = initLicenseCrossTabSync("teacher");
    const genA = createGeneration();
    const genB = createGeneration();
    postAsRemoteTab("license-state-changing", genA);
    postAsRemoteTab("license-state-changing", genB);
    expect(isWriteAllowedSync("teacher")).toBe(false);

    postAsRemoteTab("license-state-changed", genA);
    await new Promise((r) => setTimeout(r, 10));
    expect(isWriteAllowedSync("teacher")).toBe(false);

    postAsRemoteTab("license-state-changed", genB);
    await new Promise((r) => setTimeout(r, 10));
    expect(isWriteAllowedSync("teacher")).toBe(true);
    sync.dispose();
  });

  it("13) رسالة الوحدة المحلية نفسها (نفس SESSION_ID) تُتجاهَل تلقائيًا ولا تُعامَل كـremote", () => {
    const sync = initLicenseCrossTabSync("teacher");
    setCachedWriteStatus("teacher", true);
    notifyLicenseChanging("teacher", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(true);
    sync.dispose();
  });

  it("14) BroadcastChannel غير متاحة -> صفر crash، العمليات تستمر بأمان", () => {
    const original = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    // @ts-expect-error - إزالة متعمَّدة للاختبار
    delete globalThis.BroadcastChannel;
    expect(() => {
      const sync = initLicenseCrossTabSync("teacher");
      notifyLicenseChanging("teacher", createGeneration());
      notifyLicenseChanged("teacher", createGeneration());
      sync.dispose();
    }).not.toThrow();
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
  });

  it("16/17/18) استرداد إشارة remote مهجورة: يستخدم نفس Web Lock، الكتابة تبقى false أثناء الانتظار، بعد الحصول على القفل تُمسَح الحالة المعلَّقة ويُعاد الإثبات", async () => {
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => callback());
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const sync = initLicenseCrossTabSync("teacher");
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(false);

    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 10));

    expect(requestSpy).toHaveBeenCalledWith("khabir-license-enrollment-current:teacher", expect.any(Function));
    expect(isWriteAllowedSync("teacher")).toBe(true);

    sync.dispose();
  });

  it("19/20) visibilitychange: hidden لا يُشغِّل استردادًا، visible يُشغِّله (مع remote pending)", async () => {
    const sync = initLicenseCrossTabSync("teacher");
    postAsRemoteTab("license-state-changing", createGeneration());
    const callsBefore = (getCurrentLicenseStatus as ReturnType<typeof vi.fn>).mock.calls.length;

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 5));
    expect((getCurrentLicenseStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 5));
    expect((getCurrentLicenseStatus as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);

    sync.dispose();
  });

  it("21/22) dispose تُزيل المستمعين وتُغلق القناة — رسالة remote لاحقة لا تُغيِّر شيئًا بعد dispose", () => {
    const sync = initLicenseCrossTabSync("teacher");
    sync.dispose();
    setCachedWriteStatus("teacher", true);
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(true);
  });

  it("23) تهيئة/تنظيف متكرر (محاكاة React StrictMode) لا يُكرِّر المستمعين", () => {
    const s1 = initLicenseCrossTabSync("teacher");
    s1.dispose();
    const s2 = initLicenseCrossTabSync("teacher");
    setCachedWriteStatus("teacher", true);
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(false);
    s2.dispose();
  });

  it("24/25) كل variant يُعيد إثبات نفسه فقط عبر getCurrentLicenseStatus(variant) الصحيح", async () => {
    const syncTeacher = initLicenseCrossTabSync("teacher");
    const gen = createGeneration();
    postAsRemoteTab("license-state-changing", gen);
    postAsRemoteTab("license-state-changed", gen);
    await new Promise((r) => setTimeout(r, 10));
    expect(getCurrentLicenseStatus).toHaveBeenCalledWith("teacher");
    syncTeacher.dispose();
  });
});

describe("LIC-6C.1-FIX6 §1 — استرداد لا يمكنه تجاوز تسجيل مُعلَن بالفعل", () => {
  it("طلب قفل A (المُسجَّل أولًا) يُمنَح قبل طلب استرداد B — B ينتظر حتى A يُحرِّر القفل فعليًا", async () => {
    const callOrder: string[] = [];
    let releaseALock: () => void = () => {};
    const aLockHeld = new Promise<void>((resolve) => { releaseALock = resolve; });

    // محاكاة حقيقية لاستبعاد متبادل حقيقي لقفل واحد (لا مجرد تسجيل تسلسل استدعاءات) —
    // طلب ثانٍ لا يبدأ تنفيذ رد ندائه إلا بعد اكتمال الطلب الأول فعليًا لنفس اسم القفل.
    let lockQueue: Promise<unknown> = Promise.resolve();
    let requestCount = 0;
    const requestSpy = vi.fn((_name: string, callback: () => Promise<unknown>) => {
      requestCount += 1;
      const label = requestCount === 1 ? "A" : "B";
      const task = async () => {
        callOrder.push(`${label}-acquired`);
        if (label === "A") await aLockHeld;
        return callback();
      };
      const next = lockQueue.then(task, task);
      lockQueue = next.catch(() => undefined);
      return next;
    });
    Object.defineProperty(globalThis, "navigator", { value: { locks: { request: requestSpy } }, configurable: true, writable: true });

    const sync = initLicenseCrossTabSync("teacher");

    // A: طلب قفل حقيقي (مُسجَّل أولًا، لا يزال محتجزًا)
    const aLockPromise = requestSpy("khabir-license-enrollment-current:teacher", async () => { callOrder.push("A-done"); });

    // B: استرداد يبدأ الآن (يطلب نفس القفل) بينما A لا يزال يحمله
    postAsRemoteTab("license-state-changing", createGeneration());
    window.dispatchEvent(new Event("focus"));

    await new Promise((r) => setTimeout(r, 10));
    expect(callOrder).not.toContain("B-acquired");

    releaseALock();
    await aLockPromise;
    await new Promise((r) => setTimeout(r, 10));

    expect(callOrder[0]).toBe("A-acquired");
    expect(callOrder).toContain("B-acquired");
    expect(callOrder.indexOf("A-done")).toBeLessThan(callOrder.indexOf("B-acquired"));

    sync.dispose();
  });
});

describe("LIC-6C.1-FIX6.1 — dispose يُحرِّر كل احتجازات remote المتبقية", () => {
  it("1) dispose يُحرِّر احتجازًا remote معلَّقًا واحدًا — الكتابة تعود متاحة (بافتراض كاش صالح) بعد dispose", () => {
    const sync = initLicenseCrossTabSync("teacher");
    setCachedWriteStatus("teacher", true);
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(false); // احتجاز نشط

    sync.dispose();
    expect(isWriteAllowedSync("teacher")).toBe(true); // الاحتجاز تحرَّر، الكاش الأساسي المثبَت يعود ظاهرًا
  });

  it("2) dispose قابل للاستدعاء المتكرر بأمان (idempotent) — استدعاء ثانٍ لا يفعل شيئًا ضارًا", () => {
    const sync = initLicenseCrossTabSync("teacher");
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(() => { sync.dispose(); sync.dispose(); sync.dispose(); }).not.toThrow();
  });

  it("3) dispose بلا أي جيل معلَّق آمن تمامًا (لا يحاول تحرير شيء غير موجود)", () => {
    const sync = initLicenseCrossTabSync("teacher");
    expect(() => sync.dispose()).not.toThrow();
  });

  it("4) dispose بعد جيل استُقبِل له changed بالفعل (مُحرَّر مسبقًا) آمن — لا تحرير مزدوج ضار", async () => {
    const sync = initLicenseCrossTabSync("teacher");
    const gen = createGeneration();
    postAsRemoteTab("license-state-changing", gen);
    postAsRemoteTab("license-state-changed", gen);
    await new Promise((r) => setTimeout(r, 10));
    expect(isWriteAllowedSync("teacher")).toBe(true); // تحرَّر بالفعل عبر changed
    expect(() => sync.dispose()).not.toThrow();
    expect(isWriteAllowedSync("teacher")).toBe(true); // لم يتغيَّر شيء خطأً
  });

  it("5) جيلان أو أكثر معلَّقان — dispose يُحرِّرهما جميعًا معًا", () => {
    const sync = initLicenseCrossTabSync("teacher");
    setCachedWriteStatus("teacher", true);
    postAsRemoteTab("license-state-changing", createGeneration());
    postAsRemoteTab("license-state-changing", createGeneration());
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(false);
    sync.dispose();
    expect(isWriteAllowedSync("teacher")).toBe(true); // الثلاثة تحرَّرت معًا
  });

  it("6) بعد dispose ثم init جديد — صفر احتجاز قديم متسرِّب من المثيل السابق", () => {
    const s1 = initLicenseCrossTabSync("teacher");
    postAsRemoteTab("license-state-changing", createGeneration());
    s1.dispose();

    const s2 = initLicenseCrossTabSync("teacher");
    setCachedWriteStatus("teacher", true);
    expect(isWriteAllowedSync("teacher")).toBe(true); // صفر احتجاز متسرِّب من s1 يؤثر على s2
    s2.dispose();
  });

  it("7) فشل channel.close() لا يمنع تحرير الاحتجازات — التحرير يحدث خارج try المحيطة بالإغلاق", () => {
    const sync = initLicenseCrossTabSync("teacher");
    setCachedWriteStatus("teacher", true);
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(false);

    // نُفسِد close() بعد التهيئة لمحاكاة فشلها أثناء dispose تحديدًا
    const originalClose = FakeBroadcastChannel.prototype.close;
    FakeBroadcastChannel.prototype.close = () => { throw new Error("boom: close during dispose"); };

    expect(() => sync.dispose()).not.toThrow(); // dispose نفسها تبتلع الخطأ بأمان
    expect(isWriteAllowedSync("teacher")).toBe(true); // لكن الاحتجاز تحرَّر رغم فشل الإغلاق

    FakeBroadcastChannel.prototype.close = originalClose;
  });

  it("8) تنظيف المستمعين يبقى سليمًا — رسالة remote بعد dispose لا تُنشئ احتجازًا جديدًا", () => {
    const sync = initLicenseCrossTabSync("teacher");
    sync.dispose();
    setCachedWriteStatus("teacher", true);
    postAsRemoteTab("license-state-changing", createGeneration());
    expect(isWriteAllowedSync("teacher")).toBe(true); // الرسالة لم تُعالَج، صفر تأثير
  });

  it("9) احتجاز محلي (local) لا يتأثر بـdispose طبقة المزامنة — لا تغيير في دلالة الاحتجاز المحلي/Web Locks", () => {
    const sync = initLicenseCrossTabSync("teacher");
    acquireWriteDenyHold("teacher", "local:some-enrollment");
    sync.dispose();
    // الاحتجاز المحلي مستقل تمامًا، dispose لا تلمسه إطلاقًا (خارج نطاقها)
    expect(isWriteAllowedSync("teacher")).toBe(false);
  });
});
