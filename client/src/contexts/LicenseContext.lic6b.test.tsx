// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import { LicenseProvider, useLicenseStatus } from "./LicenseContext";

/**
 * PHASE LIC-6B: يختبر أن طلب refresh أقدم يكتمل متأخرًا لا يُطبِّق setStatus
 * فوق نتيجة طلب أحدث اكتمل أولًا — عبر التحكم اليدوي الدقيق في توقيت حسم
 * كل استدعاء لـ getCurrentLicenseStatus المُموَّهة.
 * PHASE LIC-6B-FIX3: استيراد ثابت عادي + vi.hoisted (بدل await import على
 * مستوى الملف وwrapper بـunknown[]) — يتوافق مع pnpm check الحقيقي.
 */

const { getCurrentLicenseStatusMock } = vi.hoisted(() => ({
  getCurrentLicenseStatusMock: vi.fn(() => new Promise((resolve) => { resolversRef.push(resolve); })),
}));
let resolversRef: Array<(status: any) => void> = [];

vi.mock("@/lib/license/licenseGuard", () => ({
  getCurrentLicenseStatus: getCurrentLicenseStatusMock,
}));
vi.mock("@/lib/license/licenseStore", () => ({
  licenseStore: { activate: vi.fn() },
}));

function StatusDisplay() {
  const { status, loading, refresh } = useLicenseStatus();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="status">{status ? status.kind : "null"}</span>
      <button onClick={() => { void refresh(); }}>refresh</button>
    </div>
  );
}

describe("LicenseContext — سباق refresh (LIC-6B)", () => {
  afterEach(() => cleanup());

  it("طلب A أقدم يكتمل متأخرًا لا يستبدل status الأحدث من B", async () => {
    resolversRef = [];
    render(<LicenseProvider variant="teacher"><StatusDisplay /></LicenseProvider>);

    // انتظار بدء الطلب الأول (A) من useEffect عند التحميل
    await waitFor(() => expect(resolversRef.length).toBe(1));

    // إطلاق طلب ثانٍ (B) يدويًا قبل اكتمال A
    act(() => { screen.getByText("refresh").click(); });
    await waitFor(() => expect(resolversRef.length).toBe(2));

    // B (الأحدث، الثاني) يكتمل أولًا
    await act(async () => { resolversRef[1]({ kind: "trial_active", writesAllowed: true, effectiveNow: "x", expiresAt: "x", clockRollbackDetected: false }); });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("trial_active"));

    // A (الأقدم) يكتمل لاحقًا بنتيجة مختلفة — يجب ألا تُطبَّق
    await act(async () => { resolversRef[0]({ kind: "trial_expired", writesAllowed: false, effectiveNow: "x", expiresAt: "x", clockRollbackDetected: false }); });

    // النتيجة تبقى من B، لا تتراجع لـ A القديمة
    expect(screen.getByTestId("status").textContent).toBe("trial_active");
  });

  it("الترتيب العكسي: A ينتهي أولًا (يُطبَّق)، B ينتهي لاحقًا (يُطبَّق فوقه لأنه فعليًا الأحدث)", async () => {
    resolversRef = [];
    render(<LicenseProvider variant="teacher"><StatusDisplay /></LicenseProvider>);
    await waitFor(() => expect(resolversRef.length).toBe(1));

    act(() => { screen.getByText("refresh").click(); });
    await waitFor(() => expect(resolversRef.length).toBe(2));

    await act(async () => { resolversRef[0]({ kind: "trial_active", writesAllowed: true, effectiveNow: "x", expiresAt: "x", clockRollbackDetected: false }); });
    await act(async () => { resolversRef[1]({ kind: "paid_active", writesAllowed: true, effectiveNow: "x", expiresAt: "x", clockRollbackDetected: false }); });

    expect(screen.getByTestId("status").textContent).toBe("paid_active");
  });
});
