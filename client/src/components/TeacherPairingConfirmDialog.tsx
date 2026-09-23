/**
 * PHASE NEXT-2D-D-C — مودال المعلم: تأكيد الاقتران بعد فتح/مسح رابط
 * المدير. **فتح الرابط وحده لا يحفظ الاقتران أبدًا** — pairRecipient لا
 * تُستدعى إلا بعد ضغط صريح لزر "ربط هذا المدير". صفر كتابة على
 * directorTrustRegistry/senderTrust/school authorization — هذا اقتران
 * فقط، لا ثقة/تفويض.
 */
import { useEffect, useState } from "react";
import { decodeDirectorPairingPayload, formatShortFingerprintDisplay, type DirectorPairingPayloadV1 } from "@/lib/directorPairingPayload";
import { pairRecipient, confirmRecipientKeyChange, type PairRecipientOutcome } from "@/lib/teacherPairedRecipients";

export default function TeacherPairingConfirmDialog({ token, onClose, onPaired }: { token: string; onClose: () => void; onPaired: () => void }) {
  const [state, setState] = useState<"loading" | "invalid" | "confirm" | "success" | "key_change">("loading");
  const [payload, setPayload] = useState<DirectorPairingPayloadV1 | null>(null);
  const [keyChangeInfo, setKeyChangeInfo] = useState<{ oldFingerprint: string; newFingerprint: string; incoming: DirectorPairingPayloadV1 } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await decodeDirectorPairingPayload(token);
      if (!live) return;
      if (!result.ok) { setState("invalid"); return; }
      setPayload(result.payload);
      setState("confirm");
    })();
    return () => { live = false; };
  }, [token]);

  const handleOutcome = (outcome: PairRecipientOutcome) => {
    if (outcome.status === "paired") { setResultMessage("تم ربط المدير بنجاح."); setState("success"); onPaired(); return; }
    if (outcome.status === "unchanged") { setResultMessage("هذا المدير مرتبط بالفعل — لا تغيير."); setState("success"); onPaired(); return; }
    if (outcome.status === "key_change_required") {
      setKeyChangeInfo({ oldFingerprint: outcome.existing.encryptionKeyFingerprint, newFingerprint: outcome.incoming.directorEncryptionKeyFingerprint, incoming: outcome.incoming });
      setState("key_change");
      return;
    }
    setState("invalid"); // invalid_payload — لن يحدث عمليًا هنا لأن decode سبق أن تحقَّق، لكن fail-closed بأي حال
  };

  const confirmPairing = async () => {
    if (!payload) return;
    setSubmitting(true);
    try {
      const outcome = await pairRecipient(payload);
      handleOutcome(outcome);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmKeyChange = async () => {
    if (!payload || !keyChangeInfo) return;
    setSubmitting(true);
    try {
      const result = await confirmRecipientKeyChange(payload.recipientId, keyChangeInfo.oldFingerprint, keyChangeInfo.newFingerprint, keyChangeInfo.incoming);
      if (result.ok) { setResultMessage("تم اعتماد مفتاح التشفير الجديد وربط المدير."); setState("success"); onPaired(); }
      else { setResultMessage("تعذّر تأكيد التغيير — أعد فتح رابط الربط من المدير مرة أخرى."); setState("invalid"); }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="teacher-pairing-overlay" role="dialog" aria-modal="true" aria-labelledby="teacher-pairing-title">
      <section className="teacher-pairing-card">
        <h2 id="teacher-pairing-title">ربط مع المدير</h2>

        {state === "loading" && <p>جارٍ التحقق من رمز الربط…</p>}

        {state === "invalid" && (
          <>
            <p role="alert">رمز الربط غير صالح أو تالف.</p>
            <button type="button" onClick={onClose}>إغلاق</button>
          </>
        )}

        {state === "confirm" && payload && (
          <>
            {payload.displayName && <p>{payload.displayName}</p>}
            <p>البصمة: <strong dir="ltr">{formatShortFingerprintDisplay(payload.directorEncryptionKeyFingerprint)}</strong></p>
            <p className="teacher-pairing-note">سيتم ربط الحزم المشفَّرة المستقبلية بهذا المستلم. هذا لا يُثبِت هوية المدير أو المدرسة رسميًا.</p>
            <div className="teacher-pairing-actions">
              <button type="button" disabled={submitting} onClick={() => { void confirmPairing(); }}>{submitting ? "جارٍ الربط…" : "ربط هذا المدير"}</button>
              <button type="button" disabled={submitting} onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}

        {state === "key_change" && keyChangeInfo && (
          <>
            <p role="alert">تم اكتشاف تغيير في مفتاح التشفير</p>
            <p>البصمة القديمة: <strong dir="ltr">{formatShortFingerprintDisplay(keyChangeInfo.oldFingerprint)}</strong></p>
            <p>البصمة الجديدة: <strong dir="ltr">{formatShortFingerprintDisplay(keyChangeInfo.newFingerprint)}</strong></p>
            <p className="teacher-pairing-note">تغيّر مفتاح التشفير لهذا المستلم. تأكد من البصمة المعروضة لدى المدير قبل اعتماد المفتاح الجديد. هذا لا يعني بالضرورة اختراقًا أو تغييرًا في هوية المدير أو المدرسة.</p>
            <div className="teacher-pairing-actions">
              <button type="button" disabled={submitting} onClick={() => { void confirmKeyChange(); }}>{submitting ? "جارٍ التأكيد…" : "اعتماد المفتاح الجديد"}</button>
              <button type="button" disabled={submitting} onClick={onClose}>إلغاء</button>
            </div>
          </>
        )}

        {state === "success" && (
          <>
            <p>{resultMessage}</p>
            <button type="button" onClick={onClose}>إغلاق</button>
          </>
        )}
      </section>
    </div>
  );
}
