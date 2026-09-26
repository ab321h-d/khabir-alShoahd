import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const readComponent = (relativePath: string) => readFileSync(path.join(dir, relativePath), "utf-8");

const directorSource = readComponent("../components/DirectorDeliveryCapabilityDialog.tsx");
const teacherSource = readComponent("../components/TeacherDeliveryCapabilityConfirmDialog.tsx");

describe("PHASE NEXT-2E-B2-A2-B-UI: DirectorDeliveryCapabilityDialog — عقد السلوك", () => {
  it("صفر QR قبل نجاح كلا التسجيلين — QRCodeSVG داخل فرع ready فقط", () => {
    const readyBranchStart = directorSource.indexOf('phase === "ready"');
    const qrIndex = directorSource.indexOf("QRCodeSVG", readyBranchStart);
    expect(qrIndex).toBeGreaterThan(readyBranchStart);
  });

  it("تسجيل القدرة يسبق تسجيل جلسة التسليم في الكود المصدري", () => {
    const capabilityCallIndex = directorSource.indexOf("registerUploadCapability(");
    const sessionCallIndex = directorSource.indexOf("registerDeliverySession(");
    expect(capabilityCallIndex).toBeGreaterThan(0);
    expect(sessionCallIndex).toBeGreaterThan(capabilityCallIndex);
  });

  it("صفر capabilitySecret يُرسَل لدالة تسجيل القدرة — capabilityVerifier فقط", () => {
    const callSite = directorSource.slice(directorSource.indexOf("registerUploadCapability("), directorSource.indexOf("registerUploadCapability(") + 200);
    expect(callSite).not.toContain("capabilitySecret");
    expect(callSite).toContain("capabilityVerifier");
  });

  it("منع double-submit: فحص phase==='creating' في بداية دالة التوليد", () => {
    const fnBody = directorSource.slice(directorSource.indexOf("const startGeneration"));
    expect(fnBody.slice(0, 200)).toContain('phase === "creating"');
  });

  it("تعارض تسجيل القدرة/الجلسة يوقف صراحة — صفر توليد بديل تلقائي داخل مسار التعارض نفسه", () => {
    const conflictBranches = directorSource.match(/status === "conflict"[\s\S]{0,150}?return;/g) ?? [];
    expect(conflictBranches.length).toBeGreaterThanOrEqual(2);
    for (const branch of conflictBranches) {
      expect(branch).not.toContain("generateCanonical");
    }
  });

  it("زر نسخ الرابط ينسخ deliveryUrl الكامل", () => {
    expect(directorSource).toContain("navigator.clipboard.writeText(deliveryUrl)");
  });

  it("تنبيه المشاركة موجود، صفر عرض لـcapabilitySecret كنص منفصل، صفر console.log", () => {
    expect(directorSource).toContain("شارك الرابط أو الرمز مع الشخص المقصود فقط");
    expect(directorSource).not.toMatch(/\{capabilitySecret\}/);
    expect(directorSource).not.toContain("console.log");
  });

  it("qrcode.react الموجودة بالفعل — صفر مكتبة جديدة", () => {
    expect(directorSource).toContain('from "qrcode.react"');
  });

  it("صفر صياغة توحي بتوثيق هوية معلم/مدرسة", () => {
    expect(directorSource).not.toContain("توثيق المعلم");
    expect(directorSource).not.toContain("اعتماد المعلم");
    expect(directorSource).not.toContain("التحقق من المدرسة");
  });
});

describe("PHASE NEXT-2E-B2-A2-B-UI: TeacherDeliveryCapabilityConfirmDialog — عقد السلوك", () => {
  it("فتح المودال لا يستدعي redeem تلقائيًا — redeemDeliverySession فقط داخل performRedeem", () => {
    const beforePerformRedeem = teacherSource.slice(0, teacherSource.indexOf("const performRedeem"));
    expect(beforePerformRedeem).not.toContain("redeemDeliverySession(");
  });

  it("زر التأكيد الأول يستدعي performRedeem صراحة عبر onClick", () => {
    expect(teacherSource).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*void performRedeem\(\);\s*\}\}/);
  });

  it("صفر capabilitySecret في استدعاء redeemDeliverySession", () => {
    const callSite = teacherSource.slice(teacherSource.indexOf("redeemDeliverySession({"), teacherSource.indexOf("redeemDeliverySession({") + 100);
    expect(callSite).not.toContain("capabilitySecret");
  });

  it("الحفظ يحدث فقط داخل فرع outcome.status==='redeemed' — عبر performLocalSave (طبقة معالجة أخطاء صريحة)", () => {
    const successBranchStart = teacherSource.indexOf('outcome.status === "redeemed"');
    const nextBranchStart = teacherSource.indexOf('outcome.status === "existing_capability_conflict"');
    const branchText = teacherSource.slice(successBranchStart, nextBranchStart);
    expect(branchText).toContain("performLocalSave(");
    // performLocalSave نفسها تستدعي confirmSaveRedeemedCapability داخل try/catch صريح — صفر فشل صامت
    const performLocalSaveFn = teacherSource.slice(teacherSource.indexOf("const performLocalSave ="));
    expect(performLocalSaveFn).toContain("confirmSaveRedeemedCapability(");
    expect(performLocalSaveFn.slice(0, 300)).toContain("try {");
  });

  it("تعارض القدرة المحلية -> صفر حفظ تلقائي، ينتقل لحالة replace_confirm", () => {
    const conflictBranchStart = teacherSource.indexOf('outcome.status === "existing_capability_conflict"');
    const conflictBranchEnd = teacherSource.indexOf('if (outcome.status === "session_unavailable"');
    const branchText = teacherSource.slice(conflictBranchStart, conflictBranchEnd);
    expect(branchText).not.toContain("confirmSaveRedeemedCapability(");
    expect(branchText).not.toContain("confirmReplaceUploadCapability(");
    expect(branchText).toContain('setState("replace_confirm")');
  });

  it("تأكيد الاستبدال الثاني يستدعي confirmReplaceUploadCapability بمعرِّف القديم المُتوقَّع صراحة", () => {
    const fnBody = teacherSource.slice(teacherSource.indexOf("const confirmReplace ="));
    expect(fnBody).toContain("confirmReplaceUploadCapability(pendingResult.recipientId, pendingResult.existing.capabilityId");
  });

  it("إلغاء الاستبدال لا يستدعي أي دالة حفظ", () => {
    const fnBody = teacherSource.slice(teacherSource.indexOf("const cancelReplace ="), teacherSource.indexOf("const cancelReplace =") + 200);
    expect(fnBody).not.toContain("confirmSaveRedeemedCapability");
    expect(fnBody).not.toContain("confirmReplaceUploadCapability");
  });

  it("network_error/malformed_response/config_error لا تُنظِّف pending intent", () => {
    const retryableBranchStart = teacherSource.lastIndexOf("setErrorMessage(");
    const retryableBranchText = teacherSource.slice(retryableBranchStart - 50, retryableBranchStart + 100);
    expect(retryableBranchText).not.toContain("clearPendingDeliveryIntent");
  });

  it("session_unavailable ينظِّف pending intent صراحة", () => {
    const branchStart = teacherSource.indexOf('outcome.status === "session_unavailable"');
    const branchText = teacherSource.slice(branchStart, branchStart + 150);
    expect(branchText).toContain("clearPendingDeliveryIntent()");
  });

  it("صفر صياغة توحي بهوية مدير/مدرسة موثَّقة", () => {
    expect(teacherSource).not.toContain("مدير موثق");
    expect(teacherSource).not.toContain("المدرسة الموثقة");
  });

  // === PHASE FIX (manual redeem failure) — اختبارات بنيوية إضافية ===

  it("§11) فشل الحفظ المحلي (local_save_error) يستدعي retryLocalSave فقط — صفر redeemDeliverySession جديد داخل هذا المسار", () => {
    const branchStart = teacherSource.indexOf('state === "local_save_error"');
    const branchEnd = teacherSource.indexOf('{state === "identity_persistence_error"');
    const branchText = teacherSource.slice(branchStart, branchEnd);
    expect(branchText).toContain("retryLocalSave");
    expect(branchText).not.toContain("performRedeem");
  });

  it("§11) فشل الفحص المحلي (local_lookup_error) يستدعي retryLocalLookup فقط — صفر إعادة redeem", () => {
    const branchStart = teacherSource.indexOf('state === "local_lookup_error"');
    const branchEnd = teacherSource.indexOf('{state === "local_save_error"');
    const branchText = teacherSource.slice(branchStart, branchEnd);
    expect(branchText).toContain("retryLocalLookup");
    expect(branchText).not.toContain("performRedeem");
  });

  it("§11) retryLocalLookup/retryLocalSave لا تستدعيان redeemDeliverySession إطلاقًا (فحص بنيوي على تعريف الدالتين)", () => {
    const retryLookupBody = teacherSource.slice(teacherSource.indexOf("const retryLocalLookup ="), teacherSource.indexOf("const retryLocalSave ="));
    const retrySaveBody = teacherSource.slice(teacherSource.indexOf("const retryLocalSave ="), teacherSource.indexOf("const retryCleanup ="));
    expect(retryLookupBody).not.toContain("redeemDeliverySession(");
    expect(retrySaveBody).not.toContain("redeemDeliverySession(");
  });

  it("§11) حالة success_cleanup_pending تعرض نجاحًا صادقًا مع مسار تنظيف آمن، صفر إعادة redeem", () => {
    const branchStart = teacherSource.indexOf('state === "success_cleanup_pending"');
    const branchEnd = teacherSource.indexOf('{state === "session_unavailable"');
    const branchText = teacherSource.slice(branchStart, branchEnd);
    expect(branchText).toContain("retryCleanup");
    expect(branchText).not.toContain("performRedeem");
  });

  it("§11) كل استدعاء async (ensurePendingDeliveryAttemptId وredeemDeliverySession) داخل performRedeem محاط بـtry/catch منفصل صريح — صفر رمي غير مُعالَج يُسقِط الواجهة بصمت", () => {
    const performRedeemBody = teacherSource.slice(teacherSource.indexOf("const performRedeem ="), teacherSource.indexOf("const retryLocalLookup ="));
    // ensurePendingDeliveryAttemptId: try/catch مستقل خاص بها
    const attemptIdTryIndex = performRedeemBody.indexOf("try {\n      attemptId = ensurePendingDeliveryAttemptId();");
    expect(attemptIdTryIndex).toBeGreaterThan(-1);
    // redeemDeliverySession: try/catch مستقل خاص بها، يلي الأول
    const redeemCallIndex = performRedeemBody.indexOf("outcome = await redeemDeliverySession(");
    const redeemTryIndex = performRedeemBody.lastIndexOf("try {", redeemCallIndex);
    const redeemCatchIndex = performRedeemBody.indexOf("} catch", redeemCallIndex);
    expect(redeemCallIndex).toBeGreaterThan(attemptIdTryIndex);
    expect(redeemCallIndex).toBeGreaterThan(redeemTryIndex);
    expect(redeemCallIndex).toBeLessThan(redeemCatchIndex);
  });

  // === PHASE FRONTEND-REDEMPTION-RECOVERY — اختبارات §5/§9/N الجديدة ===

  it("N) صفر auto-redeem أول مرة: الحالة الابتدائية بلا resolvedIdentity هي 'confirm' حصرًا (يعتمد على initialResolvedIdentity)", () => {
    expect(teacherSource).toMatch(/useState<State>\(initialResolvedIdentity \? "redeeming" : "confirm"\)/);
  });

  it("§5/§9) وجود resolvedIdentity سابقة (تأكيد بشري سابق فعلي) يُستأنَف محليًا فقط عبر useEffect — صفر استدعاء performRedeem/redeemDeliverySession في مسار الاستئناف هذا", () => {
    const effectStart = teacherSource.indexOf("useEffect(() => {");
    const effectEnd = teacherSource.indexOf("}, []);") + "}, []);".length;
    const effectBody = teacherSource.slice(effectStart, effectEnd);
    expect(effectBody).toContain("resumeLocalResolution(initialResolvedIdentity)");
    expect(effectBody).not.toContain("performRedeem(");
    expect(effectBody).not.toContain("redeemDeliverySession(");
  });

  it("resumeLocalResolution (المُستخدَمة لكل من أول نجاح واستئناف refresh) تستدعي فقط retryLocalCapabilityResolution — صفر fetch/redeemDeliverySession بداخلها", () => {
    const fnStart = teacherSource.indexOf("const resumeLocalResolution =");
    const fnEnd = teacherSource.indexOf("// §5/§9");
    const fnBody = teacherSource.slice(fnStart, fnEnd);
    expect(fnBody).toContain("retryLocalCapabilityResolution(");
    expect(fnBody).not.toContain("redeemDeliverySession(");
  });

  it("attemptId يُنشَأ حصرًا عبر ensurePendingDeliveryAttemptId داخل performRedeem — صفر توليد عشوائي مباشر (Math.random/uuid) في المكوّن", () => {
    expect(teacherSource).toContain("ensurePendingDeliveryAttemptId()");
    expect(teacherSource).not.toContain("Math.random");
    expect(teacherSource.toLowerCase()).not.toContain("uuid");
  });

  it("فشل ensurePendingDeliveryAttemptId يمنع الوصول لـredeemDeliverySession — return مبكر داخل catch", () => {
    const performRedeemBody = teacherSource.slice(teacherSource.indexOf("const performRedeem ="), teacherSource.indexOf("const retryLocalLookup ="));
    const attemptIdCatchStart = performRedeemBody.indexOf("} catch {");
    const attemptIdCatchEnd = performRedeemBody.indexOf("}", attemptIdCatchStart + 10);
    const catchBody = performRedeemBody.slice(attemptIdCatchStart, attemptIdCatchEnd);
    expect(catchBody).toContain("return;");
  });

  it("[BLOCKER-FIX] ensureIdentityFromStorageOrFail تقرأ فعليًا من sessionStorage عبر consumePendingDeliveryIntent — صفر اعتماد على initialResolvedIdentity كمصدر حقيقة بعد نجاح HTTP", () => {
    const fnStart = teacherSource.indexOf("const ensureIdentityFromStorageOrFail =");
    const fnEnd = teacherSource.indexOf("const retryCleanup =");
    const fnBody = teacherSource.slice(fnStart, fnEnd);
    expect(fnBody).toContain("readCurrentResolvedIdentity()");
    expect(fnBody).not.toContain("initialResolvedIdentity");
  });

  it("[BLOCKER-FIX] readCurrentResolvedIdentity تستدعي consumePendingDeliveryIntent فعليًا وتتحقق من تطابق sessionId الحالي قبل إعادة أي هوية", () => {
    const fnStart = teacherSource.indexOf("const readCurrentResolvedIdentity =");
    const fnEnd = teacherSource.indexOf("const retryLocalLookup =");
    const fnBody = teacherSource.slice(fnStart, fnEnd);
    expect(fnBody).toContain("consumePendingDeliveryIntent()");
    expect(fnBody).toContain("current.intent.sessionId !== sessionId");
  });
});
