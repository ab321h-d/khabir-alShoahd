import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const readComponent = (relativePath: string) => readFileSync(path.join(dir, relativePath), "utf-8");

const teacherDialogSource = readComponent("../components/TeacherPairingConfirmDialog.tsx");
const directorDialogSource = readComponent("../components/DirectorPairingDialog.tsx");

describe("PHASE NEXT-2D-D-C: TeacherPairingConfirmDialog — حدود أمنية بنيوية", () => {
  it("9) فتح/فك التوكن وحده لا يستدعي pairRecipient — الاستدعاء محصور داخل معالج ضغط زر صريح فقط", () => {
    // decodeDirectorPairingPayload تُستدعى داخل useEffect (عند فتح الرابط) — pairRecipient يجب ألا تظهر في نفس الـuseEffect
    const effectBody = teacherDialogSource.slice(teacherDialogSource.indexOf("useEffect(() => {"), teacherDialogSource.indexOf("}, [token]);"));
    expect(effectBody).toContain("decodeDirectorPairingPayload");
    expect(effectBody).not.toContain("pairRecipient(");
    // pairRecipient تظهر فقط داخل confirmPairing (تُستدعى حصرًا من onClick لزر "ربط هذا المدير")
    expect(teacherDialogSource).toMatch(/const confirmPairing = async[\s\S]{0,200}pairRecipient\(/);
  });

  it("12) صفر import/استدعاء فعلي لـdirectorTrustRegistry/senderTrust/resolveSenderTrust (التعليق التوثيقي الذي يشرح القرار لا يُحتسَب)", () => {
    expect(teacherDialogSource).not.toMatch(/^import .*(directorTrustRegistry|senderTrust)/m);
    expect(teacherDialogSource).not.toContain("resolveSenderTrust(");
    expect(teacherDialogSource).not.toContain("directorTrustRegistry.");
  });

  it("18) صفر schoolId في مكوّن المعلم", () => {
    expect(teacherDialogSource).not.toMatch(/schoolId/);
  });

  it("20) صفر ذكر لمفتاح خاص/PIN/اعتماد تفعيل/سر ترخيص في مكوّن المعلم", () => {
    expect(teacherDialogSource).not.toContain("privateKey");
    expect(teacherDialogSource).not.toContain("PIN");
    expect(teacherDialogSource).not.toContain("activationCredential");
    expect(teacherDialogSource).not.toContain("licenseSecret");
  });

  it("14) تأكيد تغيير المفتاح يستخدم confirmRecipientKeyChange بقيم oldFingerprint/newFingerprint الصريحة، لا confirm=true مجردة", () => {
    const confirmFnBody = teacherDialogSource.slice(teacherDialogSource.indexOf("const confirmKeyChange = async"));
    expect(confirmFnBody).toContain("confirmRecipientKeyChange(payload.recipientId, keyChangeInfo.oldFingerprint, keyChangeInfo.newFingerprint");
  });

  it("صفر صياغة توحي بتحقق رسمي من المدرسة/الهوية المدنية (مطابق لتحذير NEXT-2D-D-A/§7 الصريح)", () => {
    expect(teacherDialogSource).not.toContain("مدير موثق");
    expect(teacherDialogSource).not.toContain("مدير المدرسة الموثق");
    expect(teacherDialogSource).not.toContain("تم التحقق من المدرسة");
  });
});

describe("PHASE NEXT-2D-D-C: DirectorPairingDialog — إعادة استخدام الأسس، صفر توليد جديد", () => {
  it("2) recipientId/publicKey يُبنيان حصرًا من getOrCreateDirectorRecipientProfile/getOrCreateDirectorEncryptionPublicKey — صفر مولِّد جديد", () => {
    expect(directorDialogSource).toContain("getOrCreateDirectorRecipientProfile");
    expect(directorDialogSource).toContain("getOrCreateDirectorEncryptionPublicKey");
    expect(directorDialogSource).not.toContain("generateRecipientId("); // صفر توليد recipientId مستقل جديد هنا
    expect(directorDialogSource).not.toMatch(/crypto\.subtle\.generateKey/); // صفر مفتاح تشفير جديد هنا
  });

  it("19) QR/الرابط يحتوي بيانات عامة فقط — صفر ذكر لمفتاح خاص", () => {
    expect(directorDialogSource).not.toContain("privateKey");
    expect(directorDialogSource).not.toContain("CryptoKey");
  });

  it("18) صفر schoolId في مكوّن المدير", () => {
    expect(directorDialogSource).not.toMatch(/schoolId/);
  });

  it("QR مبني من qrcode.react الموجودة بالفعل — صفر مكتبة توليد إضافية", () => {
    expect(directorDialogSource).toContain('from "qrcode.react"');
  });
});

describe("PHASE NEXT-2D-D-C-FIX2: App.tsx يلتقط نية الاقتران قبل أي بوابة مصادقة", () => {
  const appSource = readComponent("../App.tsx");

  it("1/9) capturePendingPairingIntent() تُستدعى عند مستوى الوحدة، قبل تعريف App() نفسها — صفر انتظار لمصادقة/onboarding", () => {
    expect(appSource).toContain("capturePendingPairingIntent()");
    const captureIndex = appSource.indexOf("capturePendingPairingIntent()");
    const appFunctionIndex = appSource.indexOf("function App()");
    expect(captureIndex).toBeGreaterThan(0);
    expect(captureIndex).toBeLessThan(appFunctionIndex);
  });

  it("App.tsx لا يستدعي pairRecipient إطلاقًا — الالتقاط منفصل تمامًا عن أي حفظ فعلي", () => {
    expect(appSource).not.toContain("pairRecipient(");
  });
});
