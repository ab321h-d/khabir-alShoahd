import { lazy, Suspense, useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { appVariant, isDirectorStandalone, isTeacherStandalone } from "./lib/appVariant";
import { appAppearance, appPreferenceKeys, appProtection } from "./lib/appPreferences";
import { brandEmblemUrl, brandWordmarkUrl } from "./lib/brand";
import { LicenseProvider } from "./contexts/LicenseContext";
import { LicenseActivation } from "./components/LicenseActivation";
import { DirectorAuthGate } from "./components/DirectorAuthGate";
import { TeacherAuthGate } from "./components/TeacherAuthGate";

const Home = isDirectorStandalone ? null : lazy(() => import("./pages/Home"));
const Director = isTeacherStandalone ? null : lazy(() => import("./pages/Director"));

function Router() {
  if (appVariant === "director") {
    if (!Director) return <NotFound />;
    return <Suspense fallback={<main dir="rtl" className="director-loading">جارٍ فتح مساحة المدير…</main>}><DirectorAuthGate><Director /></DirectorAuthGate></Suspense>;
  }
  if (!Home) return <NotFound />;
  return (
    <Switch>
      <Route path={"/"}><Suspense fallback={<main dir="rtl" className="director-loading">جارٍ فتح التطبيق…</main>}><TeacherAuthGate><Home /></TeacherAuthGate></Suspense></Route>
      {!isTeacherStandalone && Director && <Route path={"/director"}><Suspense fallback={<main dir="rtl" className="director-loading">جارٍ فتح مساحة المدير…</main>}><DirectorAuthGate><Director /></DirectorAuthGate></Suspense></Route>}
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLock({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const refresh = () => {
      appAppearance.applyStoredTheme();
      setLocked(appProtection.hasPassword() && !appProtection.isUnlocked());
      setReady(true);
    };
    refresh();
    window.addEventListener(appPreferenceKeys.lockEventName, refresh);
    return () => window.removeEventListener(appPreferenceKeys.lockEventName, refresh);
  }, []);

  const unlock = async () => {
    setChecking(true);
    setError("");
    try {
      if (await appProtection.verify(password)) {
        setPassword("");
        setLocked(false);
      } else setError("كلمة المرور غير صحيحة. حاول مرة أخرى.");
    } catch {
      setError("تعذر التحقق من كلمة المرور على هذا الجهاز.");
    } finally {
      setChecking(false);
    }
  };

  if (!ready) return null;
  if (!locked) return <>{children}</>;
  return (
    <main className="app-lock-screen" dir="rtl">
      <section className="app-lock-card" aria-labelledby="app-lock-title">
        <span className="app-lock-mark"><LockKeyhole size={24} /></span>
        <p>حماية محلية</p>
        <h1 id="app-lock-title">خبير الشواهد مقفل</h1>
        <span>أدخل كلمة المرور التي عيّنتها على هذا الجهاز لفتح التطبيق.</span>
        <label><span>كلمة المرور</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void unlock(); }} autoFocus autoComplete="current-password" /></label>
        {error && <div role="alert">{error}</div>}
        <button type="button" onClick={() => { void unlock(); }} disabled={!password || checking}>{checking ? "جارٍ التحقق…" : "فتح التطبيق"}</button>
        <small>لا تُرسل كلمة المرور أو تُخزن في حساب سحابي.</small>
      </section>
    </main>
  );
}

function AppSplash({ onFinish }: { onFinish: () => void }) {
  const [emblemReady, setEmblemReady] = useState(false);
  const [wordmarkReady, setWordmarkReady] = useState(false);
  const brandReady = emblemReady && wordmarkReady;

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onFinish, brandReady ? (reduceMotion ? 300 : 720) : 1800);
    return () => window.clearTimeout(timer);
  }, [brandReady, onFinish]);

  return (
    <main className="app-splash" dir="rtl" role="status" aria-live="polite" aria-label="جارٍ فتح تطبيق خبير الشواهد">
      <section className="app-splash-card">
        <span className="app-splash-emblem-wrap"><img className="app-splash-emblem" src={brandEmblemUrl} alt="" aria-hidden="true" onLoad={() => setEmblemReady(true)} onError={() => setEmblemReady(true)} /></span>
        <img className="app-splash-wordmark" src={brandWordmarkUrl} alt="خبير الشواهد — أبرز إنجازاتك بكل سهولة" onLoad={() => setWordmarkReady(true)} onError={() => setWordmarkReady(true)} />
        <p>جارٍ تجهيز مساحة إنجازك</p>
        <span className="app-splash-progress" aria-hidden="true"><i /></span>
      </section>
    </main>
  );
}

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const licenseVariant = appVariant === "director" ? "director" : "teacher";
  return (
    <ErrorBoundary>
      <LicenseProvider variant={licenseVariant}>
        <AppLock><Router /></AppLock>
        <LicenseActivation />
      </LicenseProvider>
      {showSplash && <AppSplash onFinish={() => setShowSplash(false)} />}
    </ErrorBoundary>
  );
}

export default App;
