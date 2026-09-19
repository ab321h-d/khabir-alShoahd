import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  lockDirectorSession,
  resolveDirectorAccess,
  verifyDirectorPin,
  startDirectorTrial,
  completeDirectorActivation,
  type DirectorAccessState,
  type DirectorSession,
} from "@/lib/directorAuth";
import type { AuthorizedSchool, SchoolStage } from "@/lib/identityStore";

const stageOptions: Array<{ value: SchoolStage; label: string }> = [
  { value: "elementary", label: "ابتدائي" },
  { value: "middle", label: "متوسط" },
  { value: "secondary", label: "ثانوي" },
];

// ===== Context: يوفر الجلسة + إجراء القفل + طلب التفعيل لأي مكوّن داخلي =====

type DirectorAuthContextValue = { session: DirectorSession; lock: () => void; requestActivation: () => void };
const DirectorAuthContext = createContext<DirectorAuthContextValue | null>(null);

export const useDirectorAuth = (): DirectorAuthContextValue => {
  const value = useContext(DirectorAuthContext);
  if (!value) throw new Error("useDirectorAuth يجب أن يُستخدَم داخل DirectorAuthGate بعد المصادقة");
  return value;
};

// ===== PHASE PILOT-50-F3.4 — الشاشة الأولى: بدء التجربة (رقم وزاري فقط) =====

function DirectorTrialStartScreen({ onSuccess }: { onSuccess: () => void }) {
  const [schoolId, setSchoolId] = useState("");
  const [step, setStep] = useState<"school" | "pin">("school");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitSchool = () => {
    setError("");
    if (!schoolId.trim()) { setError("الرجاء إدخال الرقم الوزاري."); return; }
    setStep("pin");
  };

  const submitPin = async () => {
    setError("");
    if (!/^[0-9]{6}$/.test(pin)) { setError("صيغة الرمز غير صالحة — يجب أن يتكون من 6 أرقام."); return; }
    if (pin !== confirmPin) { setError("الرمزان غير متطابقين."); return; }
    setSubmitting(true);
    try {
      await startDirectorTrial({ schoolId: schoolId.trim(), pin, confirmPin });
      onSuccess();
    } catch {
      setError("تعذر بدء التجربة. حاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "school") {
    return (
      <main dir="rtl" className="director-auth-screen">
        <section className="director-auth-card" aria-labelledby="director-trial-title">
          <h1 id="director-trial-title">تجربة خبير المدير</h1>
          <label><span>الرقم الوزاري</span><input type="text" inputMode="numeric" value={schoolId} onChange={(event) => setSchoolId(event.target.value)} autoComplete="off" autoFocus onKeyDown={(event) => { if (event.key === "Enter") submitSchool(); }} /></label>
          {error && <div role="alert" className="director-auth-error">{error}</div>}
          <button type="button" onClick={submitSchool} disabled={!schoolId.trim()}>بدء التجربة</button>
        </section>
      </main>
    );
  }

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="director-trial-pin-title">
        <h1 id="director-trial-pin-title">إنشاء رمز الدخول</h1>
        <label><span>الرمز (6 أرقام)</span><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))} autoFocus autoComplete="off" /></label>
        <label><span>تأكيد الرمز</span><input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/[^0-9]/g, ""))} autoComplete="off" onKeyDown={(event) => { if (event.key === "Enter") void submitPin(); }} /></label>
        {error && <div role="alert" className="director-auth-error">{error}</div>}
        <button type="button" onClick={() => { void submitPin(); }} disabled={submitting || pin.length !== 6 || confirmPin.length !== 6}>{submitting ? "جارٍ الدخول…" : "دخول خبير المدير"}</button>
      </section>
    </main>
  );
}

// ===== شاشة إدخال PIN (locked/cooldown) — تعمل لكلا trial وactivated =====

function DirectorPinScreen({ access, onSuccess, onTrialExpired }: { access: Extract<DirectorAccessState, { status: "locked" }>; onSuccess: () => void; onTrialExpired: (userId: string) => void }) {
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
    if (!/^[0-9]{6}$/.test(pin)) return setError("صيغة الرمز غير صالحة.");
    setSubmitting(true);
    try {
      const result = await verifyDirectorPin(access.identity, pin);
      if (result.ok) { onSuccess(); return; }
      setPin("");
      if (result.reason === "cooldown") setError("تم قفل الحساب مؤقتًا بعد محاولات متكررة.");
      else if (result.reason === "disabled") setError("هذا الحساب معطَّل حاليًا.");
      else if (result.reason === "trial_expired") { onTrialExpired(access.identity.userId); return; }
      else setError("الرمز غير صحيح.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="director-pin-title">
        <h1 id="director-pin-title">{access.authorizationKind === "trial" ? "تجربة خبير المدير" : `مرحبًا بك`}</h1>
        <p>{access.identity.schoolId}</p>
        <label><span>رمز الدخول</span><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/[^0-9]/g, ""))} autoFocus autoComplete="off" onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} disabled={inCooldown} /></label>
        {error && <div role="alert" className="director-auth-error">{error}</div>}
        {inCooldown && <p className="director-auth-cooldown">يُرجى الانتظار {remainingSeconds} ثانية قبل المحاولة مجددًا.</p>}
        <button type="button" onClick={() => { void submit(); }} disabled={submitting || inCooldown || pin.length !== 6}>{submitting ? "جارٍ التحقق…" : "دخول"}</button>
      </section>
    </main>
  );
}

// ===== انتهاء التجربة =====

function DirectorTrialExpiredScreen({ userId, onActivated }: { userId: string; onActivated: () => void }) {
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mismatchSchools, setMismatchSchools] = useState<AuthorizedSchool[] | null>(null);

  const submit = async (confirmSchoolMismatch: boolean) => {
    setError("");
    if (!confirmSchoolMismatch) setMismatchSchools(null);
    if (!credential.trim()) { setError("الرجاء إدخال رمز التفعيل."); return; }
    setSubmitting(true);
    try {
      const result = await completeDirectorActivation(userId, credential.trim(), { confirmSchoolMismatch });
      if (result.ok) { onActivated(); return; }
      if (result.reason === "school_mismatch") {
        setMismatchSchools(result.authorizedSchools ?? []);
        setError("رمز التفعيل مرتبط بمدارس مختلفة عن الرقم الذي بدأت به التجربة.");
      } else {
        setMismatchSchools(null);
        setError("رمز التفعيل غير صالح.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="director-trial-expired-title">
        <h1 id="director-trial-expired-title">انتهت الفترة التجريبية</h1>
        <p>بياناتك محفوظة بالكامل. فعِّل خبير المدير للمتابعة.</p>
        <label><span>رمز التفعيل</span><input type="text" value={credential} onChange={(event) => { setCredential(event.target.value); setMismatchSchools(null); }} onPaste={(event) => setCredential(event.clipboardData.getData("text"))} autoComplete="off" disabled={mismatchSchools !== null} /></label>
        {error && <div role="alert" className="director-auth-error">{error}</div>}
        {mismatchSchools ? (
          <>
            <p>سيتم اعتماد المدارس المخوَّلة في رمز التفعيل فقط: {mismatchSchools.map((school) => school.schoolId).join("، ")}</p>
            <button type="button" onClick={() => { void submit(true); }} disabled={submitting}>{submitting ? "جارٍ التفعيل…" : "المتابعة بالمدارس المخوَّلة"}</button>
            <button type="button" onClick={() => { setMismatchSchools(null); setError(""); setCredential(""); }} disabled={submitting}>إلغاء</button>
          </>
        ) : (
          <button type="button" onClick={() => { void submit(false); }} disabled={submitting || !credential.trim()}>{submitting ? "جارٍ التفعيل…" : "تفعيل خبير المدير"}</button>
        )}
      </section>
    </main>
  );
}

// ===== شاشة التفعيل من داخل workspace التجربة النشطة — نفس منطق تأكيد التعارض =====

function DirectorActivationScreen({ userId, onActivated }: { userId: string; onActivated: () => void }) {
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mismatchSchools, setMismatchSchools] = useState<AuthorizedSchool[] | null>(null);

  const submit = async (confirmSchoolMismatch: boolean) => {
    setError("");
    if (!confirmSchoolMismatch) setMismatchSchools(null);
    if (!credential.trim()) { setError("الرجاء إدخال رمز التفعيل."); return; }
    setSubmitting(true);
    try {
      const result = await completeDirectorActivation(userId, credential.trim(), { confirmSchoolMismatch });
      if (result.ok) { onActivated(); return; }
      if (result.reason === "school_mismatch") {
        setMismatchSchools(result.authorizedSchools ?? []);
        setError("رمز التفعيل مرتبط بمدارس مختلفة عن الرقم الذي بدأت به التجربة.");
      } else {
        setMismatchSchools(null);
        setError("رمز التفعيل غير صالح.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="director-activation-title">
        <h1 id="director-activation-title">تفعيل خبير المدير</h1>
        <label><span>رمز التفعيل</span><input type="text" value={credential} onChange={(event) => { setCredential(event.target.value); setMismatchSchools(null); }} onPaste={(event) => setCredential(event.clipboardData.getData("text"))} autoComplete="off" disabled={mismatchSchools !== null} /></label>
        {error && <div role="alert" className="director-auth-error">{error}</div>}
        {mismatchSchools ? (
          <>
            <p>سيتم اعتماد المدارس المخوَّلة في رمز التفعيل فقط: {mismatchSchools.map((school) => school.schoolId).join("، ")}</p>
            <button type="button" onClick={() => { void submit(true); }} disabled={submitting}>{submitting ? "جارٍ التفعيل…" : "المتابعة بالمدارس المخوَّلة"}</button>
            <button type="button" onClick={() => { setMismatchSchools(null); setError(""); setCredential(""); }} disabled={submitting}>إلغاء</button>
          </>
        ) : (
          <button type="button" onClick={() => { void submit(false); }} disabled={submitting || !credential.trim()}>{submitting ? "جارٍ التفعيل…" : "تفعيل"}</button>
        )}
      </section>
    </main>
  );
}

// ===== البوابة المركزية =====

export function DirectorAuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<DirectorAccessState>({ status: "loading" });
  const [showActivationScreen, setShowActivationScreen] = useState(false);
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
    return <DirectorTrialStartScreen onSuccess={() => { void refresh(); }} />;
  }
  if (access.status === "locked") {
    return <DirectorPinScreen access={access} onSuccess={() => { void refresh(); }} onTrialExpired={() => { void refresh(); }} />;
  }
  if (access.status === "trial_expired") {
    return <DirectorTrialExpiredScreen userId={access.userId} onActivated={() => { void refresh(); }} />;
  }

  if (showActivationScreen && access.session.authorizationKind === "trial") {
    return <DirectorActivationScreen userId={access.session.userId} onActivated={() => { setShowActivationScreen(false); void refresh(); }} />;
  }

  const lock = () => { lockDirectorSession(access.session.userId); void refresh(); };
  const requestActivation = () => setShowActivationScreen(true);
  return <DirectorAuthContext.Provider value={{ session: access.session, lock, requestActivation }}>{children}</DirectorAuthContext.Provider>;
}
