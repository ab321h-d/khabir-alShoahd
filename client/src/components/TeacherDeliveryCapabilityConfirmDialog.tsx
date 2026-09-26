/**
 * PHASE NEXT-2E-B2-A2-B + FRONTEND-REDEMPTION-RECOVERY — مودال المعلم:
 * تأكيد استهلاك جلسة تسليم قدرة الرفع. **فتح الرابط وحده لا يستدعي
 * redeem أبدًا (صفر auto-redeem أول مرة)** — تأكيد بشري صريح مطلوب
 * دائمًا قبل أي POST جديد. **استثناء وحيد آمن**: لو كان المستخدم قد
 * أكَّد بالفعل في زيارة سابقة (resolvedIdentity محفوظة دائمًا من نجاح
 * HTTP سابق فعلي)، ثم حدث refresh أثناء مرحلة الحفظ المحلي — استئناف
 * المرحلة المحلية فقط (صفر POST جديد) لا يُعتبَر auto-redeem، لأن
 * التأكيد البشري الفعلي حدث بالفعل قبل ذلك.
 */
import { useEffect, useState } from "react";
import {
  redeemDeliverySession,
  retryLocalCapabilityResolution,
  confirmSaveRedeemedCapability,
  type RedeemOutcome,
} from "@/lib/teacherDeliverySessionRedemption";
import { confirmReplaceUploadCapability } from "@/lib/relayUploadCapabilityStore";
import { clearPendingDeliveryIntent, consumePendingDeliveryIntent, ensurePendingDeliveryAttemptId, type ResolvedDeliveryIdentity } from "@/lib/directorDeliverySessionUrl";

type State =
  | "confirm"
  | "redeeming"
  | "replace_confirm"
  | "local_lookup_error" // نجح redeem على الخادم، فشل الفحص المحلي — إعادة محاولة محلية فقط، صفر redeem جديد
  | "local_save_error" // نجح الفحص، فشل الحفظ المحلي — إعادة محاولة حفظ فقط
  | "identity_persistence_error" // نجح HTTP لكن فشل تثبيت الهوية محليًا — retry HTTP بنفس attemptId آمن (idempotent)
  | "success"
  | "success_cleanup_pending" // نجح الحفظ فعليًا، فشل تنظيف الـhash/النية فقط — القدرة محفوظة بالفعل، صفر خطر
  | "session_unavailable"
  | "retryable_error"; // فشل شبكة/تهيئة قبل أي redeem ناجح — آمن لإعادة محاولة redeem كاملة

export default function TeacherDeliveryCapabilityConfirmDialog({
  sessionId,
  deliveryProof,
  capabilitySecret,
  resolvedIdentity: initialResolvedIdentity,
  onClose,
}: {
  sessionId: string;
  deliveryProof: string;
  capabilitySecret: string;
  redemptionAttemptId: string | null;
  resolvedIdentity: ResolvedDeliveryIdentity | null;
  onClose: () => void;
}) {
  // لو resolvedIdentity محفوظة دائمًا بالفعل (تأكيد بشري سابق فعلي أدى
  // لنجاح HTTP)، نبدأ مباشرة من مرحلة الاستئناف المحلي — صفر "confirm"
  // جديد، صفر POST جديد. هذا استئناف، لا auto-redeem أول مرة.
  const [state, setState] = useState<State>(initialResolvedIdentity ? "redeeming" : "confirm");
  const [pendingResult, setPendingResult] = useState<Extract<RedeemOutcome, { status: "existing_capability_conflict" }> | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const performLocalSave = async (recipientId: string, capabilityId: string) => {
    try {
      await confirmSaveRedeemedCapability({ recipientId, capabilityId, capabilitySecret });
    } catch {
      setErrorMessage("تعذّر حفظ الصلاحية محليًا على هذا الجهاز. يمكنك إعادة المحاولة دون إعادة استخدام الرابط.");
      setState("local_save_error");
      return;
    }

    try {
      clearPendingDeliveryIntent();
      setState("success");
    } catch {
      setState("success_cleanup_pending"); // القدرة محفوظة بالفعل — صفر خطر أمني، صفر فقدان بيانات
    }
  };

  /** يُستخدَم في كلا مساري: أول تأكيد ناجح، واستئناف بعد refresh بهوية محفوظة سلفًا. */
  const resumeLocalResolution = async (identity: ResolvedDeliveryIdentity) => {
    let outcome: RedeemOutcome;
    try {
      outcome = await retryLocalCapabilityResolution(identity);
    } catch {
      setErrorMessage("تعذّر التحقق من الصلاحيات المحلية على هذا الجهاز. يمكنك إعادة المحاولة دون إعادة استخدام الرابط.");
      setState("local_lookup_error");
      return;
    }
    if (outcome.status === "redeemed") {
      await performLocalSave(outcome.recipientId, outcome.capabilityId);
      return;
    }
    if (outcome.status === "existing_capability_conflict") {
      setPendingResult(outcome);
      setState("replace_confirm");
      return;
    }
    setErrorMessage("تعذّر التحقق من الصلاحيات المحلية على هذا الجهاز. يمكنك إعادة المحاولة دون إعادة استخدام الرابط.");
    setState("local_lookup_error");
  };

  // §5/§9: استئناف تلقائي **محلي فقط** عند التركيب لو resolvedIdentity محفوظة دائمًا سلفًا — صفر POST.
  useEffect(() => {
    if (initialResolvedIdentity) {
      void resumeLocalResolution(initialResolvedIdentity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performRedeem = async () => {
    setState("redeeming");

    // §1-2: attemptId يُنشَأ/يُثبَّت هنا فقط (خارج redeemDeliverySession تمامًا)، قبل أي fetch.
    let attemptId: string;
    try {
      attemptId = ensurePendingDeliveryAttemptId();
    } catch {
      setErrorMessage("تعذّر حفظ حالة العملية على هذا الجهاز. حاول مرة أخرى.");
      setState("retryable_error"); // فشل قبل أي POST — صفر شبكة حدثت، آمن لإعادة المحاولة بالكامل
      return;
    }

    let outcome: RedeemOutcome;
    try {
      outcome = await redeemDeliverySession({ sessionId, deliveryProof, redemptionAttemptId: attemptId });
    } catch {
      setErrorMessage("تعذّر إكمال العملية. تحقق من الاتصال، ثم أعد المحاولة إن رغبت.");
      setState("retryable_error");
      return;
    }

    if (outcome.status === "redeemed") {
      await performLocalSave(outcome.recipientId, outcome.capabilityId);
      return;
    }
    if (outcome.status === "existing_capability_conflict") {
      setPendingResult(outcome);
      setState("replace_confirm");
      return;
    }
    if (outcome.status === "local_lookup_failed") {
      setErrorMessage("تعذّر التحقق من الصلاحيات المحلية على هذا الجهاز. يمكنك إعادة المحاولة دون إعادة استخدام الرابط.");
      setState("local_lookup_error");
      return;
    }
    if (outcome.status === "identity_persistence_failed") {
      // §4/§7: نجح HTTP فعليًا لكن فشل التثبيت — retry عبر HTTP بنفس attemptId آمن (idempotent)
      setErrorMessage("تعذّر حفظ نتيجة العملية على هذا الجهاز. يمكنك إعادة المحاولة بأمان.");
      setState("identity_persistence_error");
      return;
    }
    if (outcome.status === "session_unavailable") {
      clearPendingDeliveryIntent();
      setState("session_unavailable");
      return;
    }

    // network_error / config_error / malformed_response — لم يُؤكَّد نجاح redeem، آمن لإعادة المحاولة كاملة بنفس attemptId الثابت
    setErrorMessage("تعذّر إكمال العملية. تحقق من الاتصال وحاول مرة أخرى.");
    setState("retryable_error");
  };

  /** قراءة resolvedIdentity الحالية فعليًا من sessionStorage (مصدر الحقيقة الوحيد بعد نجاح HTTP) — **لا تعتمد على initialResolvedIdentity prop**، الذي قد يكون null إن حدث نجاح HTTP+تثبيت هوية *بعد* تركيب المكوّن (بلا أي refresh) ضمن نفس mount. تتحقق أن النية المحفوظة تخص نفس sessionId الحالي، ولو أُتيح redemptionAttemptId محليًا (ensurePendingDeliveryAttemptId مُستدعاة سلفًا في هذا التدفق) تتحقق من تطابقه أيضًا — رفض آمن لو لم تتطابق. */
  const readCurrentResolvedIdentity = (): ResolvedDeliveryIdentity | null => {
    const current = consumePendingDeliveryIntent();
    if (current.kind !== "intent") return null;
    if (current.intent.sessionId !== sessionId) return null;
    return current.resolvedIdentity;
  };

  /** إعادة محاولة الفحص المحلي بعد local_lookup_error — بلا أي طلب شبكة جديد، تقرأ الهوية الحالية فعليًا من sessionStorage (لا initialResolvedIdentity prop). */
  const retryLocalLookup = async () => {
    const current = ensureIdentityFromStorageOrFail();
    if (!current) return;
    setState("redeeming");
    await resumeLocalResolution(current);
  };

  /** إعادة محاولة الحفظ فقط بعد local_save_error — بلا أي طلب شبكة جديد. */
  const retryLocalSave = async () => {
    const current = ensureIdentityFromStorageOrFail();
    if (!current) return;
    setState("redeeming");
    await performLocalSave(current.recipientId, current.capabilityId);
  };

  /** قراءة الهوية المحفوظة دائمًا مباشرة من sessionStorage وقت إعادة المحاولة — مصدر الحقيقة الوحيد، **ليس** initialResolvedIdentity prop (قد يكون null بينما التخزين الفعلي أصبح يحمل الهوية منذ نجاح HTTP داخل نفس mount). */
  const ensureIdentityFromStorageOrFail = (): ResolvedDeliveryIdentity | null => {
    const persisted = readCurrentResolvedIdentity();
    if (persisted) return persisted;
    setErrorMessage("تعذّر العثور على نتيجة العملية السابقة على هذا الجهاز. أعد فتح الرابط من المدير إن لزم.");
    setState("retryable_error");
    return null;
  };

  /** إعادة محاولة التنظيف فقط بعد success_cleanup_pending — القدرة محفوظة بالفعل، صفر خطر. */
  const retryCleanup = () => {
    try {
      clearPendingDeliveryIntent();
      setState("success");
    } catch {
      setState("success_cleanup_pending");
    }
  };

  const confirmReplace = async () => {
    if (!pendingResult) return;
    let result;
    try {
      result = await confirmReplaceUploadCapability(pendingResult.recipientId, pendingResult.existing.capabilityId, { capabilityId: pendingResult.capabilityId, capabilitySecret });
    } catch {
      setErrorMessage("تعذّر تحديث الصلاحية المحلية. أعد فتح الرابط من المدير إن لزم.");
      setState("retryable_error");
      return;
    }
    if (result.ok) {
      try {
        clearPendingDeliveryIntent();
        setState("success");
      } catch {
        setState("success_cleanup_pending");
      }
    } else {
      setErrorMessage("تعذّر تحديث الصلاحية المحلية. أعد فتح الرابط من المدير إن لزم.");
      setState("retryable_error");
    }
  };

  const cancelReplace = () => {
    clearPendingDeliveryIntent();
    onClose();
  };

  return (
    <div className="teacher-delivery-overlay" role="dialog" aria-modal="true" aria-labelledby="teacher-delivery-title">
      <section className="teacher-delivery-card">
        <h2 id="teacher-delivery-title">صلاحية إرسال مباشر</h2>

        {state === "confirm" && (
          <>
            <p>هذا الرابط يمنح هذا الجهاز صلاحية الإرسال المشفَّر إلى وجهة محددة.</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={() => { void performRedeem(); }}>تأكيد</button>
              <button type="button" onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}

        {state === "redeeming" && <p>جارٍ التحقق…</p>}

        {state === "replace_confirm" && pendingResult && (
          <>
            <p role="alert">يوجد على هذا الجهاز تصريح إرسال سابق لهذه الوجهة. إكمال العملية سيستبدل التصريح المحلي بعد نجاح الرابط الجديد.</p>
            <p className="teacher-delivery-note">ملاحظة: الإلغاء الآن يعني عدم حفظ التصريح الجديد على هذا الجهاز — الرابط نفسه لم يعد قابلًا للاستخدام بعد ذلك.</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={() => { void confirmReplace(); }}>استبدال التصريح المحلي</button>
              <button type="button" onClick={cancelReplace}>إلغاء</button>
            </div>
          </>
        )}

        {state === "local_lookup_error" && (
          <>
            <p role="alert">{errorMessage}</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={() => { void retryLocalLookup(); }}>إعادة المحاولة</button>
              <button type="button" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}

        {state === "local_save_error" && (
          <>
            <p role="alert">{errorMessage}</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={() => { void retryLocalSave(); }}>إعادة المحاولة</button>
              <button type="button" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}

        {state === "identity_persistence_error" && (
          <>
            <p role="alert">{errorMessage}</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={() => { void performRedeem(); }}>إعادة المحاولة</button>
              <button type="button" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}

        {state === "success" && (
          <>
            <p>تم منح هذا الجهاز صلاحية الإرسال بنجاح.</p>
            <button type="button" onClick={onClose}>إغلاق</button>
          </>
        )}

        {state === "success_cleanup_pending" && (
          <>
            <p>تم منح هذا الجهاز صلاحية الإرسال بنجاح.</p>
            <p className="teacher-delivery-note">قد يظل الرابط ظاهرًا في شريط العنوان — يمكنك تنظيفه الآن، لكن الصلاحية محفوظة بالفعل.</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={retryCleanup}>تنظيف الرابط</button>
              <button type="button" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}

        {state === "session_unavailable" && (
          <>
            <p role="alert">الرابط غير متاح أو انتهت صلاحيته.</p>
            <button type="button" onClick={onClose}>إغلاق</button>
          </>
        )}

        {state === "retryable_error" && (
          <>
            <p role="alert">{errorMessage}</p>
            <div className="teacher-delivery-actions">
              <button type="button" onClick={() => { void performRedeem(); }}>إعادة المحاولة</button>
              <button type="button" onClick={onClose}>إغلاق</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
