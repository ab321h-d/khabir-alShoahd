import { useEffect, useRef, useState, createContext, useContext, type ReactNode } from "react";
import {
  lockTeacherSession,
  resolveTeacherAccess,
  setupTeacherOnboarding,
  verifyTeacherPin,
  type TeacherAccessState,
} from "@/lib/teacherAuth";
import { identityStore, type SchoolStage, type StoredIdentity, type UserIdentity } from "@/lib/identityStore";

/**
 * PHASE ID-3B: مطابقة مقصودة لبنية DirectorAuthGate.tsx (نفس النمط
 * المُثبَت)، لكن مستقلة تمامًا في الكود — صفر استيراد من directorAuth.ts أو
 * DirectorAuthGate.tsx. تُعيد استخدام أصناف CSS العامة director-auth-*
 * الموجودة أصلًا (تصميم مطابق، لا مكتبة UI جديدة، لا تكرار قواعد).
 */

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

// ===== شاشة التفعيل (activation-required) =====

function TeacherActivationScreen({ onSuccess }: { onSuccess: () => void }) {
  const [stage, setStage] = useState<SchoolStage>("elementary");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError("");
    const trimmedDisplayName = displayName.trim();

    if (!trimmedDisplayName) {
      setError("الرجاء إدخال اسمك.");
      return;
    }

    setSubmitting(true);
    try {
      await setupTeacherOnboarding({
        stage,
        displayName: trimmedDisplayName,
      });
      onSuccess();
    } catch {
      setError("تعذر بدء الاستخدام. حاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="director-auth-screen">
      <section className="director-auth-card" aria-labelledby="teacher-onboarding-title">
        <h1 id="teacher-onboarding-title">مرحبًا بك في خبير الشواهد</h1>
        <p>ابدأ تجربتك المجانية</p>

        <label>
          <span>الاسم</span>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="name"
          />
        </label>

        <label>
          <span>المرحلة</span>
          <select value={stage} onChange={(event) => setStage(event.target.value as SchoolStage)}>
            {stageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {error && <div role="alert" className="director-auth-error">{error}</div>}

        <button type="button" onClick={() => { void submit(); }} disabled={submitting}>
          {submitting ? "جارٍ البدء…" : "ابدأ الآن"}
        </button>
      </section>
    </main>
  );
}

// ===== شاشة إدخال PIN (locked/cooldown) =====

function TeacherPinScreen({ access, onSuccess }: { access: Extract<TeacherAccessState, { status: "locked" }>; onSuccess: () => void }) {
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
      const result = await verifyTeacherPin(access.identity, pin);
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
      <section className="director-auth-card" aria-labelledby="teacher-pin-title">
        <h1 id="teacher-pin-title">مرحبًا، {access.identity.displayName}</h1>
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

// ===== PHASE ID-3D.1: هوية المعلم المصادَق عليها كاملة، مُتاحة لـHome.tsx =====

type TeacherIdentityContextValue = { identity: StoredIdentity };
const TeacherIdentityContext = createContext<TeacherIdentityContextValue | null>(null);

/**
 * يُستخدَم داخل أي مكوّن ضمن مساحة المعلم بعد المصادقة (مثل Home.tsx عند
 * بناء identity.json) — يوفّر UserIdentity الكاملة (بما فيها displayName)،
 * لا فقط TeacherSession. teacherId يجب أن يُؤخَذ دائمًا من identity.userId،
 * لا من أي مصدر آخر.
 */
export const useTeacherIdentity = (): TeacherIdentityContextValue => {
  const value = useContext(TeacherIdentityContext);
  if (!value) throw new Error("useTeacherIdentity يجب أن يُستخدَم داخل TeacherAuthGate بعد المصادقة");
  return value;
};

// ===== البوابة المركزية =====

export function TeacherAuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<TeacherAccessState>({ status: "loading" });
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = async () => {
    const next = await resolveTeacherAccess();
    if (next.status === "authenticated") {
      // هوية كاملة (بما فيها displayName) — TeacherSession وحدها لا تحملها.
      // إعادة استخدام مباشرة لـ identityStore.getIdentityById الموجودة أصلًا
      // (نفس ما تستخدمه teacherAuth.ts داخليًا) — صفر تعديل على identityStore.ts.
      const fullIdentity = await identityStore.getIdentityById(next.session.userId);
      if (!mountedRef.current) return;
      if (!fullIdentity) { setAccess({ status: "activation-required" }); return; }
      setIdentity(fullIdentity);
      setAccess(next);
      return;
    }
    if (mountedRef.current) { setAccess(next); setIdentity(null); }
  };

  useEffect(() => { void refresh(); }, []);

  if (access.status === "loading") {
    return <main dir="rtl" className="director-auth-loading">جارٍ التحقق…</main>;
  }
  if (access.status === "activation-required") {
    return <TeacherActivationScreen onSuccess={() => { void refresh(); }} />;
  }
  if (access.status === "locked") {
    return <TeacherPinScreen access={access} onSuccess={() => { void refresh(); }} />;
  }

  // authenticated — لكن ننتظر اكتمال جلب الهوية الكاملة قبل عرض children،
  // بلا أي وميض لمحتوى بلا هوية متاحة.
  if (!identity) {
    return <main dir="rtl" className="director-auth-loading">جارٍ التحقق…</main>;
  }

  return <TeacherIdentityContext.Provider value={{ identity }}>{children}</TeacherIdentityContext.Provider>;
}
