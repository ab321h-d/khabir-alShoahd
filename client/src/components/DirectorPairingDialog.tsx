/**
 * PHASE NEXT-2D-D-C — مودال المدير: "ربط معلم". يبني DirectorPairingPayloadV1
 * حصرًا من الأسس المُثبَتة الموجودة بالفعل (صفر توليد recipientId/fingerprint
 * مستقل جديد): getOrCreateDirectorRecipientProfile + getOrCreateDirectorEncryptionPublicKey
 * + computeDirectorEncryptionKeyFingerprint + encodeDirectorPairingPayload.
 * فتح متكرر لهذا المودال **لا يُنشئ** recipientId/createdAt/مفتاح تشفير
 * جديدًا إطلاقًا — كلها مثابرة بالفعل عبر IndexedDB.
 *
 * صفر ربط بـcollaborationInvite.ts — مكوّن مستقل تمامًا بجانبه.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Copy, Check } from "lucide-react";
import { getOrCreateDirectorRecipientProfile } from "@/lib/directorRecipientProfile";
import { getOrCreateDirectorEncryptionPublicKey } from "@/lib/directorEncryptionIdentity";
import { encodeDirectorPairingPayload, computeDirectorEncryptionKeyFingerprint, formatShortFingerprintDisplay, type DirectorPairingPayloadV1 } from "@/lib/directorPairingPayload";
import { buildDirectorPairingUrl } from "@/lib/directorPairingUrl";

export default function DirectorPairingDialog({ open, onClose, displayName }: { open: boolean; onClose: () => void; displayName?: string }) {
  const [pairingUrl, setPairingUrl] = useState<string | null>(null);
  const [shortFingerprint, setShortFingerprint] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(""); setCopied(false);
    void (async () => {
      try {
        const [recipientProfile, publicKeyJwk] = await Promise.all([
          getOrCreateDirectorRecipientProfile(),
          getOrCreateDirectorEncryptionPublicKey(),
        ]);
        const fingerprint = await computeDirectorEncryptionKeyFingerprint(publicKeyJwk);
        const payload: DirectorPairingPayloadV1 = {
          schemaVersion: 1,
          recipientId: recipientProfile.recipientId,
          directorEncryptionPublicKeyJwk: publicKeyJwk,
          directorEncryptionKeyFingerprint: fingerprint,
          createdAt: recipientProfile.createdAt,
          ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
        };
        const encoded = await encodeDirectorPairingPayload(payload);
        if (!live) return;
        if (!encoded.ok) { setError("تعذر تجهيز رمز الربط"); return; }
        setPairingUrl(buildDirectorPairingUrl(encoded.token));
        setShortFingerprint(formatShortFingerprintDisplay(fingerprint));
      } catch {
        if (live) setError("تعذر تجهيز رمز الربط");
      }
    })();
    return () => { live = false; };
  }, [open, displayName]);

  const copyLink = async () => {
    if (!pairingUrl) return;
    try {
      await navigator.clipboard.writeText(pairingUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback صامت — الرابط يبقى معروضًا للنسخ اليدوي */ }
  };

  if (!open) return null;
  return (
    <div className="director-pairing-overlay" role="dialog" aria-modal="true" aria-labelledby="director-pairing-title">
      <section className="director-pairing-card">
        <header><h2 id="director-pairing-title">ربط معلم</h2><button type="button" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></header>
        {error && <p role="alert" className="director-pairing-error">{error}</p>}
        {pairingUrl && (
          <>
            <div className="director-pairing-qr"><QRCodeSVG value={pairingUrl} size={220} /></div>
            <p className="director-pairing-fingerprint">البصمة: <strong dir="ltr">{shortFingerprint}</strong></p>
            <p className="director-pairing-note">يحتوي رمز الربط على بيانات اتصال عامة فقط.</p>
            <button type="button" className="director-pairing-copy" onClick={() => { void copyLink(); }}>
              {copied ? <><Check size={16} /> تم النسخ</> : <><Copy size={16} /> نسخ رابط الربط</>}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
