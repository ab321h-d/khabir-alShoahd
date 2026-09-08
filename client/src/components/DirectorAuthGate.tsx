import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  lockDirectorSession,
  resolveDirectorAccess,
  setupDirector,
  verifyDirectorPin,
  type DirectorAccessState,
  type DirectorSession,
} from "@/lib/directorAuth";
import { DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK } from "@/lib/directorActivationConfig";
import type { SchoolStage } from "@/lib/identityStore";

const stageOptions: Array<{ value: SchoolStage; label: string }> = [
  { value: "elementary", label: "ابتدائي" },
  { value: "middle", label: "متوسط" },
  { value: "secondary", label: "ثانوي" },
];

/** رسالة موجَّهة للمستخدم فقط — لا تفاصيل تقنية، لا crypto، لا stack traces. */
const humanActivationError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no_public_key")) return "التفعيل غير مهيأ في هذه النسخة بعد.";
  if (message.includes("expired")) return "رمز التفعيل منتهي.";
  if (message.includes("scope_mismatch")) return "بيانات المدرسة/المرحلة لا تطابق رمز التفعيل.";
  if (message.includes("already_consumed")) return "رمز التفعيل استُخدم من قبل على هذا الجهاز.";
  if (message.includes("PIN وتأكيده")) return "PIN وتأكيده غير متطابقين.";
  if (message.includes("صيغة PIN")) return "صيغة PIN غير صالحة — يجب أن تتكون من 6 أرقام.";
  return "رمز التفعيل غير صالح.";
};

// ===== Context: يوفر الجلسة الحالية + إجراء القفل لأي مكوّن داخل مساحة المدير المصادَق عليها =====

type DirectorAuthContextValue = { session: DirectorSession; lock: () => void };
const DirectorAuthContext = createContext<DirectorAuthContextValue | null>(null);

/** يُستخدَم داخل أي مكوّن ضمن مساحة المدير بعد المصادقة (مثل زر "قفل الحساب" في Director.tsx). */
export const useDirectorAuth = (): DirectorAuthContextValue => {
  const value = useContext(DirectorAuthContext);
  if (!value) throw new Error("useDirectorAuth يجب أن يُستخدَم داخل DirectorAuthGate بعد المصادقة");
  return value;
};

// ===== شاشة التفعيل (activation-required) =====

function DirectorActivationScreen({ onSuccess }: { onSuccess: () => void }) {
  const [schoolId, setSchoolId] = useState("");
  const [stage, setStage] = useState<SchoolStage>("elementary");
  const [displayName, setDisplayName] = useState("");
  const [activationCredential, setActivationCredential] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!DIRECTOR_ACTIVATION_PUBLIC_KEY_JWK) {
    return (
      <main dir="rtl" className="director-auth-screen">
        <section className="director-auth-card">
          <h1>التفعيل غير مهيأ في هذه النسخة بعد</h1>
          <p>لا حاجة لإعادة المحاولة الآن — يُرجى مراجعة الجهة المسؤولة عن توزيع نسخة المدير.</p>
        </section>
      </main>
    );
  }

  const submit = async () => {
    setError("");
    const trimmedSchoolId = schoolId.trim();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedSchoolId) return setError("الرجاء إدخال الرقم الوزاري.");
    if (!trimmedDisplayName) return setError("الرجاء إدخال اسم المدير.");
    if (!/^[0-9]{6}$/.test(pin)) return setError("صيغة PIN غير صالحة — يجب أن تتكون من 6 أرقام.");
    if (pin !== confirmPin) return setError("PIN وتأكيده غير متطابقين.");
    if (!activationCredential.trim()) return setError("الرجاء إدخال رمز تفعيل المدير.");

    setSubmitting(true);
    try {
      await setupDirector({ activationCredential: activationCredential.trim(), schoolId: trimmedSchoolId, stage, displayName: trimmedDisplayName, pin, confirmPin });
      onSuccess();
    } catch (activationError) {
      setError(humanActivationError(activationError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="director-activation-title">
        <h1 id="director-activation-title">تفعيل نسخة المدير</h1>
        <label><span>الرقم الوزاري</span><input type="text" value={schoolId} onChange={(event) => setSchoolId(event.target.value)} autoComplete="off" /></label>
        <label><span>المرحلة</span>
          <select value={stage} onChange={(event) => setStage(event.target.value as SchoolStage)}>
            {stageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label><span>اسم المدير</span><input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="off" /></label>
        <label><span>رمز تفعيل المدير</span><input type="text" value={activationCredential} onChange={(event) => setActivationCredential(event.target.value)} autoComplete="off" /></label>
        <label><span>PIN (6 أرقام)</span><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))} autoComplete="off" /></label>
        <label><span>تأكيد PIN</span><input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/[^0-9]/g, ""))} autoComplete="off" /></label>
        {error && <div role="alert" className="director-auth-error">{error}</div>}
        <button type="button" onClick={() => { void submit(); }} disabled={submitting}>{submitting ? "جارٍ التفعيل…" : "تفعيل"}</button>
      </section>
    </main>
  );
}

// ===== شاشة إدخال PIN (locked/cooldown) =====

function DirectorPinScreen({ access, onSuccess }: { access: Extract<DirectorAccessState, { status: "locked" }>; onSuccess: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!access.cooldownUntil) { setRemainingSeconds(null); return; }
    const tick = () => {
      const secondsLeft = Math.max(0, Math.ceil((new Date(access.cooldownUntil!).getTime() - Date.now()) / 1000));
      setRemainingSeconds(secondsLeft);
      return secondsLeft;
    };
    if (tick() === 0) return;
    const interval = window.setInterval(() => { if (tick() === 0) window.clearInterval(interval); }, 1000);
    return () => window.clearInterval(interval);
  }, [access.cooldownUntil]);

  const inCooldown = remainingSeconds !== null && remainingSeconds > 0;

  const submit = async () => {
    if (inCooldown) return;
    setError("");
    if (!/^[0-9]{6}$/.test(pin)) return setError("صيغة PIN غير صالحة — يجب أن تتكون من 6 أرقام.");
    setSubmitting(true);
    try {
      const result = await verifyDirectorPin(access.identity, pin);
      if (result.ok) { onSuccess(); return; }
      setPin("");
      if (result.reason === "cooldown") setError("تم قفل الحساب مؤقتًا بعد محاولات متكررة.");
      else if (result.reason === "disabled") setError("هذا الحساب معطَّل حاليًا.");
      else setError("PIN غير صحيح.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="director-pin-title">
        <h1 id="director-pin-title">مرحبًا، {access.identity.displayName}</h1>
        <p>{access.identity.schoolId} — {stageOptions.find((option) => option.value === access.identity.stage)?.label}</p>
        <label><span>PIN</span><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))} autoFocus autoComplete="off" onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} disabled={inCooldown} /></label>
        {error && <div role="alert" className="director-auth-error">{error}</div>}
        {inCooldown && <p className="director-auth-cooldown">يُرجى الانتظار {remainingSeconds} ثانية قبل المحاولة مجددًا.</p>}
        <button type="button" onClick={() => { void submit(); }} disabled={submitting || inCooldown || pin.length !== 6}>{submitting ? "جارٍ التحقق…" : "دخول"}</button>
      </section>
    </main>
  );
}

// ===== البوابة المركزية =====

export function DirectorAuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<DirectorAccessState>({ status: "loading" });
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = async () => {
    const next = await resolveDirectorAccess();
    if (mountedRef.current) setAccess(next);
  };

  useEffect(() => { void refresh(); }, []);

  if (access.status === "loading") {
    return <main dir="rtl" className="director-auth-loading">جارٍ التحقق…</main>;
  }
  if (access.status === "activation-required") {
    return <DirectorActivationScreen onSuccess={() => { void refresh(); }} />;
  }
  if (access.status === "locked") {
    return <DirectorPinScreen access={access} onSuccess={() => { void refresh(); }} />;
  }

  const lock = () => { lockDirectorSession(); void refresh(); };
  return <DirectorAuthContext.Provider value={{ session: access.session, lock }}>{children}</DirectorAuthContext.Provider>;
}
