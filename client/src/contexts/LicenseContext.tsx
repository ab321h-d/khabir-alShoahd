import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getCurrentLicenseStatus } from "@/lib/license/licenseGuard";
import { licenseStore } from "@/lib/license/licenseStore";
import type { ActivationResult, AppLicenseVariant, LicenseStatus } from "@/lib/license/licenseTypes";

/**
 * PHASE B.7: يستهلك فقط API الموجودة فعليًا في PHASE B.5
 * (getCurrentLicenseStatus من licenseGuard.ts، licenseStore.activate) —
 * لا يعيد تنفيذ أي منطق حساب حالة أو تجربة. لا يستدعي
 * licenseStore.getOrInitializeState() مباشرة (تلك مسؤولية داخلية لـ
 * getCurrentLicenseStatus نفسها).
 */

type LicenseContextValue = {
  variant: AppLicenseVariant;
  status: LicenseStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  activate: (code: string) => Promise<ActivationResult>;
};

const LicenseContext = createContext<LicenseContextValue | undefined>(undefined);

export function LicenseProvider({ children, variant }: { children: React.ReactNode; variant: AppLicenseVariant }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getCurrentLicenseStatus(variant);
      setStatus(next);
    } finally {
      setLoading(false);
    }
  }, [variant]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activate = useCallback(async (code: string) => {
    const result = await licenseStore.activate(code, variant);
    if (result.ok) await refresh();
    return result;
  }, [variant, refresh]);

  return (
    <LicenseContext.Provider value={{ variant, status, loading, refresh, activate }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicenseStatus() {
  const context = useContext(LicenseContext);
  if (!context) throw new Error("useLicenseStatus must be used within LicenseProvider");
  return context;
}
