import { describe, expect, it, vi } from "vitest";
import { performTrustedImportSave } from "./directorImportOrchestration";

describe("PILOT-50-F3.1: performTrustedImportSave — منع الحفظ الفعلي عند replay (لا مجرد تحذير)", () => {
  it("A) أول استيراد ناجح لـexportId جديد -> save تُستدعى مرة واحدة بالضبط + markExportIdSeen تُستدعى", async () => {
    const save = vi.fn(async () => ({ id: "sub-1" }));
    const markExportIdSeen = vi.fn(async () => {});
    const findExistingSubmissionByExportId = vi.fn(async () => null);

    const outcome = await performTrustedImportSave({ exportId: "exp-a1", findExistingSubmissionByExportId, markExportIdSeen, save });

    expect(outcome.status).toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(markExportIdSeen).toHaveBeenCalledTimes(1);
    expect(markExportIdSeen).toHaveBeenCalledWith("exp-a1");
  });

  it("B) [الخلل الأصلي المُصحَّح] استيراد ثانٍ ووجود سجل فعلي بنفس exportId -> save لا تُستدعى إطلاقًا", async () => {
    const save = vi.fn(async () => ({ id: "sub-2" }));
    const markExportIdSeen = vi.fn(async () => {});
    const findExistingSubmissionByExportId = vi.fn(async () => ({ id: "existing-submission" }));

    const outcome = await performTrustedImportSave({ exportId: "exp-b1", findExistingSubmissionByExportId, markExportIdSeen, save });

    expect(outcome.status).toBe("rejected_replay");
    expect(save).not.toHaveBeenCalled();
    expect(markExportIdSeen).not.toHaveBeenCalled();
  });

  it("فشل الحفظ الأول -> markExportIdSeen لا تُستدعى إطلاقًا", async () => {
    const save = vi.fn(async () => { throw new Error("storage failed"); });
    const markExportIdSeen = vi.fn(async () => {});
    const findExistingSubmissionByExportId = vi.fn(async () => null);

    const outcome = await performTrustedImportSave({ exportId: "exp-c1", findExistingSubmissionByExportId, markExportIdSeen, save });

    expect(outcome.status).toBe("save_failed");
    expect(markExportIdSeen).not.toHaveBeenCalled();
  });

  it("إعادة محاولة بعد فشل -> save مسموحة مرة أخرى", async () => {
    let attempt = 0;
    const save = vi.fn(async () => { attempt += 1; if (attempt === 1) throw new Error("transient"); return { id: "sub-d" }; });
    const markExportIdSeen = vi.fn(async () => {});
    const findExistingSubmissionByExportId = vi.fn(async () => null);

    const first = await performTrustedImportSave({ exportId: "exp-d1", findExistingSubmissionByExportId, markExportIdSeen, save });
    expect(first.status).toBe("save_failed");

    const second = await performTrustedImportSave({ exportId: "exp-d1", findExistingSubmissionByExportId, markExportIdSeen, save });
    expect(second.status).toBe("saved");
    expect(save).toHaveBeenCalledTimes(2);
    expect(markExportIdSeen).toHaveBeenCalledTimes(1);
  });

  it("exportId=null (حزمة legacy/فشل تحقق) -> صفر فحص/تسجيل replay، الحفظ يستمر كما كان دائمًا", async () => {
    const save = vi.fn(async () => ({ id: "sub-legacy" }));
    const markExportIdSeen = vi.fn(async () => {});
    const findExistingSubmissionByExportId = vi.fn(async () => null);

    const outcome = await performTrustedImportSave({ exportId: null, findExistingSubmissionByExportId, markExportIdSeen, save });

    expect(outcome.status).toBe("saved");
    expect(findExistingSubmissionByExportId).not.toHaveBeenCalled();
    expect(markExportIdSeen).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("PILOT-50-F3.2: نجاح save + فشل markExportIdSeen لاحقًا — لا يجوز أن يُنتِج تكرارًا", () => {
  it("C) save تنجح، markExportIdSeen تفشل -> النتيجة تبقى 'saved' (فشل الطبقة المعلوماتية لا يُبطِل النجاح الحقيقي)", async () => {
    const save = vi.fn(async () => ({ id: "sub-c1" }));
    const markExportIdSeen = vi.fn(async () => { throw new Error("trust registry write failed"); });
    const findExistingSubmissionByExportId = vi.fn(async () => null);

    const outcome = await performTrustedImportSave({ exportId: "exp-c1", findExistingSubmissionByExportId, markExportIdSeen, save });

    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") expect(outcome.submission).toEqual({ id: "sub-c1" });
  });

  it("C) إعادة محاولة بعد (save نجحت + markExportIdSeen فشلت) -> save الثانية لا تُستدعى إطلاقًا لأن السجل الحقيقي موجود بالفعل في directorStore", async () => {
    const secondSave = vi.fn(async () => ({ id: "sub-c1-duplicate" }));
    const markExportIdSeen = vi.fn(async () => {});
    const findExistingSubmissionByExportIdNowFindsIt = vi.fn(async () => ({ id: "sub-c1" }));

    const retryOutcome = await performTrustedImportSave({
      exportId: "exp-c1",
      findExistingSubmissionByExportId: findExistingSubmissionByExportIdNowFindsIt,
      markExportIdSeen,
      save: secondSave,
    });

    expect(retryOutcome.status).toBe("rejected_replay");
    expect(secondSave).not.toHaveBeenCalled();
  });
});
