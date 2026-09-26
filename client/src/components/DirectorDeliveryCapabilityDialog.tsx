/**
 * PHASE NEXT-2E-B2-A2-B — مودال المدير: "منح صلاحية الإرسال المباشر".
 * **منفصل تمامًا** عن DirectorPairingDialog (Pairing V1 = اختيار وجهة
 * تشفير فقط) — يُنشئ upload capability + delivery session، صفر تعديل
 * على semantics الاقتران.
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Copy, Check } from "lucide-react";
import { getOrCreateDirectorRelayAuthPublicKey } from "@/lib/directorRelayAuthIdentity";
import { registerDirectorRelayAuthKey } from "@/lib/directorRelayAuthRegistration";
import { generateCanonical16ByteToken, generateCanonical32ByteToken, computeRawSha256Verifier } from "@/lib/relayUploadCapabilityCrypto";
import { registerUploadCapability } from "@/lib/directorUploadCapabilityRegistration";
import { registerDeliverySession } from "@/lib/directorDeliverySessionRegistration";
import { buildDeliverySessionUrl } from "@/lib/directorDeliverySessionUrl";

type Phase = "idle" | "creating" | "ready" | "error";

export default function DirectorDeliveryCapabilityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [deliveryUrl, setDeliveryUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const startGeneration = async () => {
    if (phase === "creating") return; // منع double-submit
    setPhase("creating");
    setErrorMessage("");
    setDeliveryUrl(null);

    try {
      await getOrCreateDirectorRelayAuthPublicKey();
      const authOutcome = await registerDirectorRelayAuthKey();
      if (authOutcome.status !== "created" && authOutcome.status !== "unchanged") {
        setErrorMessage("تعذّر التحقق من مصادقة المدير. حاول مرة أخرى.");
        setPhase("error");
        return;
      }

      const capabilityId = generateCanonical16ByteToken();
      const capabilitySecret = generateCanonical32ByteToken();
      const capabilityVerifier = await computeRawSha256Verifier(capabilitySecret);

      const capabilityOutcome = await registerUploadCapability({ capabilityId, capabilityVerifier });
      if (capabilityOutcome.status === "conflict") {
        setErrorMessage("تعذّر إنشاء صلاحية جديدة بسبب تعارض. أعد المحاولة يدويًا.");
        setPhase("error");
        return;
      }
      if (capabilityOutcome.status !== "created" && capabilityOutcome.status !== "unchanged") {
        setErrorMessage("تعذّر تسجيل صلاحية الإرسال. تحقق من الاتصال وحاول مرة أخرى.");
        setPhase("error");
        return;
      }

      const sessionId = generateCanonical16ByteToken();
      const deliveryProof = generateCanonical32ByteToken();
      const deliveryProofVerifier = await computeRawSha256Verifier(deliveryProof);

      const sessionOutcome = await registerDeliverySession({ capabilityId, sessionId, deliveryProofVerifier });
      if (sessionOutcome.status === "conflict") {
        setErrorMessage("تعذّر إنشاء رابط تسليم بسبب تعارض. أعد المحاولة يدويًا.");
        setPhase("error");
        return;
      }
      if (sessionOutcome.status !== "created" && sessionOutcome.status !== "unchanged") {
        setErrorMessage("تعذّر إنشاء رابط التسليم. تحقق من الاتصال وحاول مرة أخرى.");
        setPhase("error");
        return;
      }

      const url = buildDeliverySessionUrl(sessionId, deliveryProof, capabilitySecret);
      setDeliveryUrl(url);
      setPhase("ready");
    } catch {
      setErrorMessage("حدث خطأ غير متوقَّع. حاول مرة أخرى.");
      setPhase("error");
    }
  };

  const copyLink = async () => {
    if (!deliveryUrl) return;
    try {
      await navigator.clipboard.writeText(deliveryUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* الرابط يبقى معروضًا للنسخ اليدوي */ }
  };

  if (!open) return null;
  return (
    <div className="director-delivery-overlay" role="dialog" aria-modal="true" aria-labelledby="director-delivery-title">
      <section className="director-delivery-card">
        <header>
          <h2 id="director-delivery-title">منح صلاحية الإرسال المباشر</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button>
        </header>

        {phase === "idle" && (
          <>
            <p className="director-delivery-note">هذا يمنح الجهاز الذي يفتح الرابط صلاحية إرسال حزم مشفَّرة إلى وجهتك — منفصل تمامًا عن ربط معلم (اختيار وجهة التشفير).</p>
            <button type="button" onClick={() => { void startGeneration(); }}>إنشاء رابط مؤقت</button>
          </>
        )}

        {phase === "creating" && <p>جارٍ الإنشاء…</p>}

        {phase === "ready" && deliveryUrl && (
          <>
            <div className="director-delivery-qr"><QRCodeSVG value={deliveryUrl} size={220} /></div>
            <p className="director-delivery-note">هذا الرابط مؤقت ويُستخدم مرة واحدة، وتحدد الخدمة صلاحيته (تنتهي الجلسة خلال نحو 10 دقائق).</p>
            <p className="director-delivery-warning">شارك الرابط أو الرمز مع الشخص المقصود فقط.</p>
            <button type="button" className="director-delivery-copy" onClick={() => { void copyLink(); }}>
              {copied ? <><Check size={16} /> تم النسخ</> : <><Copy size={16} /> نسخ الرابط</>}
            </button>
          </>
        )}

        {phase === "error" && (
          <>
            <p role="alert">{errorMessage}</p>
            <button type="button" onClick={() => { void startGeneration(); }}>إعادة المحاولة</button>
          </>
        )}
      </section>
    </div>
  );
}
