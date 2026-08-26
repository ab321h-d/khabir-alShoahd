import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLicenseStatus } from "@/contexts/LicenseContext";

/**
 * PHASE B.7: بنية ووظيفة فقط، بلا تصميم بصري نهائي. لا تحجب أي شيء — لا يوجد
 * أي شرط "ممنوع" هنا؛ العرض دائمًا متاح، والتفعيل يعمل عبر
 * licenseStore.activate (استدعاء غير مباشر عبر LicenseContext.activate).
 * لا Write Guard في هذا الملف ولا استدعاء لـ assertWriteAllowed/isWriteAllowedSync.
 */

const statusLabel: Record<string, string> = {
  trial_active: "تجربة مجانية سارية",
  trial_expired: "انتهت التجربة المجانية",
  paid_active: "ترخيص مفعَّل وسارٍ",
  paid_expired: "انتهت صلاحية الترخيص",
  wrong_scope: "هذا الترخيص غير مخصص لهذا التطبيق",
};

const formatDate = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
};

function LicenseActivationForm() {
  const { status, loading, activate, refresh } = useLicenseStatus();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const handleActivate = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await activate(code.trim());
      if (result.ok) {
        setFeedback({ kind: "success", message: "تم تفعيل الترخيص بنجاح." });
        setCode("");
      } else {
        setFeedback({ kind: "error", message: result.error });
      }
    } catch {
      setFeedback({ kind: "error", message: "تعذّر التحقق من كود التفعيل. حاول مرة أخرى." });
    } finally {
      setSubmitting(false);
      await refresh();
    }
  };

  return (
    <Card dir="rtl" className="text-right">
      <CardHeader>
        <CardTitle>حالة الترخيص</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading || !status ? (
          <p className="text-sm text-muted-foreground">جارٍ التحقق من حالة الترخيص محليًا…</p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">{statusLabel[status.kind] || status.kind}</p>
            <p className="text-muted-foreground">تاريخ الانتهاء: {formatDate(status.expiresAt)}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="license-activation-code" className="text-sm font-medium">
            أدخل كود التفعيل أو التجديد
          </label>
          <div className="flex gap-2">
            <Input
              id="license-activation-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="كود التفعيل"
              dir="ltr"
              className="text-left"
            />
            <Button onClick={handleActivate} disabled={submitting || !code.trim()}>
              {submitting ? "جارٍ التحقق…" : "تفعيل"}
            </Button>
          </div>
          {feedback ? (
            <p className={feedback.kind === "success" ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
              {feedback.message}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * نقطة الدخول الثابتة (LicenseStatusEntry سابقًا كملف منفصل — مُضمَّنة هنا
 * حسب الضابط). زر صغير ثابت يفتح نافذة التفعيل، لا يحجب أي شيء، ظاهر دائمًا.
 */
export function LicenseActivation() {
  const { status } = useLicenseStatus();
  const label = status ? statusLabel[status.kind] || status.kind : "الترخيص";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          dir="rtl"
          aria-label="فتح حالة الترخيص والتفعيل"
          style={{ position: "fixed", bottom: 12, insetInlineEnd: 12, zIndex: 40, fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(0,0,0,0.15)", background: "#fff" }}
        >
          {label}
        </button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="text-right">
        <DialogTitle>الترخيص والتفعيل</DialogTitle>
        <LicenseActivationForm />
      </DialogContent>
    </Dialog>
  );
}
