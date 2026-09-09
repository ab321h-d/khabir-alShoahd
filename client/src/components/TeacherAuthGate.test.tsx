// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeacherAuthGate, useTeacherIdentity } from "./TeacherAuthGate";

/**
 * PHASE ID-3B: اختبارات رسم حقيقية لـTeacherAuthGate عبر
 * @testing-library/react — تُموِّه teacherAuth.ts/teacherActivationConfig.ts
 * عند حدود الاستيراد فقط. لا تعديل على منطق المصادقة الداخلي إطلاقًا؛
 * منطق teacherAuth نفسه مُختبَر بعمق ومنفصل في teacherAuth.test.ts
 * (25/25 PASS) — هذا الملف يختبر الرسم والتفاعل فقط.
 */

const resolveTeacherAccessMock = vi.fn();
const setupTeacherMock = vi.fn();
const verifyTeacherPinMock = vi.fn();
const lockTeacherSessionMock = vi.fn();

vi.mock("@/lib/teacherAuth", () => ({
  resolveTeacherAccess: (...args: unknown[]) => resolveTeacherAccessMock(...args),
  setupTeacher: (...args: unknown[]) => setupTeacherMock(...args),
  verifyTeacherPin: (...args: unknown[]) => verifyTeacherPinMock(...args),
  lockTeacherSession: (...args: unknown[]) => lockTeacherSessionMock(...args),
}));

const getIdentityByIdMock = vi.fn();
vi.mock("@/lib/identityStore", () => ({
  identityStore: { getIdentityById: (...args: unknown[]) => getIdentityByIdMock(...args) },
}));

let mockedPublicKey: object | null = { kty: "EC" };
vi.mock("@/lib/teacherActivationConfig", () => ({
  get TEACHER_ACTIVATION_PUBLIC_KEY_JWK() { return mockedPublicKey; },
}));


const HomeMarker = () => <div data-testid="teacher-home-marker">Home Content</div>;

const sampleIdentity = { userId: "user-1", role: "teacher" as const, schoolId: "2002", stage: "middle" as const, displayName: "أ. نورة", createdAt: "", updatedAt: "", status: "active" as const };
const sampleSession = { userId: "user-1", role: "teacher" as const, schoolId: "2002", stage: "middle" as const, deviceId: "device-1", authenticatedAt: "" };

beforeEach(() => {
  vi.clearAllMocks();
  mockedPublicKey = { kty: "EC" };
  getIdentityByIdMock.mockResolvedValue(sampleIdentity);
});

afterEach(() => cleanup());

describe("TeacherAuthGate — الرسم والتفاعل", () => {
  it("1) لا يُصيَّر children أثناء حسم resolveTeacherAccess المعلَّق", async () => {
    let resolveFn!: (value: unknown) => void;
    resolveTeacherAccessMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    expect(screen.queryByTestId("teacher-home-marker")).toBeNull();
    resolveFn({ status: "activation-required" });
    cleanup();
  });

  it("2) يعرض نموذج التفعيل عند activation-required", async () => {
    resolveTeacherAccessMock.mockResolvedValue({ status: "activation-required" });
    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText("تفعيل نسخة المعلم"); });
    expect(screen.queryByTestId("teacher-home-marker")).toBeNull();
    cleanup();
  });

  it("3) يعرض children عند authenticated", async () => {
    resolveTeacherAccessMock.mockResolvedValue({ status: "authenticated", session: sampleSession });
    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByTestId("teacher-home-marker"); });
    cleanup();
  });

  it("B) authenticated Home تستقبل UserIdentity الصحيحة (teacherId=userId، بما فيها displayName) عبر useTeacherIdentity", async () => {
    resolveTeacherAccessMock.mockResolvedValue({ status: "authenticated", session: sampleSession });
    getIdentityByIdMock.mockResolvedValue(sampleIdentity);

    function IdentityConsumer() {
      const { identity } = useTeacherIdentity();
      return <div data-testid="identity-dump">{identity.userId}|{identity.schoolId}|{identity.stage}|{identity.displayName}</div>;
    }

    render(<TeacherAuthGate><IdentityConsumer /></TeacherAuthGate>);
    await waitFor(() => { screen.getByTestId("identity-dump"); });
    expect(screen.getByTestId("identity-dump").textContent).toBe("user-1|2002|middle|أ. نورة");
    expect(getIdentityByIdMock).toHaveBeenCalledWith("user-1");
    cleanup();
  });

  it("4) لا يعرض children عند locked", async () => {
    resolveTeacherAccessMock.mockResolvedValue({ status: "locked", identity: sampleIdentity, cooldownUntil: null });
    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText(/مرحبًا/); });
    expect(screen.queryByTestId("teacher-home-marker")).toBeNull();
    cleanup();
  });

  it("5) PIN صحيح ينقل الحالة من locked إلى authenticated", async () => {
    resolveTeacherAccessMock
      .mockResolvedValueOnce({ status: "locked", identity: sampleIdentity, cooldownUntil: null })
      .mockResolvedValueOnce({ status: "authenticated", session: sampleSession });
    verifyTeacherPinMock.mockResolvedValue({ ok: true, session: sampleSession });

    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText(/مرحبًا/); });

    const pinInput = screen.getByLabelText("PIN") as HTMLInputElement;
    fireEvent.change(pinInput, { target: { value: "246810" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await waitFor(() => { screen.getByTestId("teacher-home-marker"); });
    expect(verifyTeacherPinMock).toHaveBeenCalledWith(sampleIdentity, "246810");
    cleanup();
  });

  it("6) PIN خاطئ يبقي الحالة locked", async () => {
    resolveTeacherAccessMock.mockResolvedValue({ status: "locked", identity: sampleIdentity, cooldownUntil: null });
    verifyTeacherPinMock.mockResolvedValue({ ok: false, reason: "invalid_pin" });

    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText(/مرحبًا/); });

    fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await waitFor(() => { screen.getByText("PIN غير صحيح."); });
    expect(screen.queryByTestId("teacher-home-marker")).toBeNull();
    cleanup();
  });

  it("7) حالة/رسالة cooldown تظهر بوضوح", async () => {
    const cooldownUntil = new Date(Date.now() + 15_000).toISOString();
    resolveTeacherAccessMock.mockResolvedValue({ status: "locked", identity: sampleIdentity, cooldownUntil });

    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText(/يُرجى الانتظار/); });
    cleanup();
  });

  it("8) مفتاح عام null يفشل بأمان (fail-closed) بدل عرض نموذج فارغ", async () => {
    mockedPublicKey = null;
    resolveTeacherAccessMock.mockResolvedValue({ status: "activation-required" });

    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText("التفعيل غير مهيأ في هذه النسخة بعد"); });
    expect(screen.queryByLabelText("رمز تفعيل المعلم")).toBeNull();
    cleanup();
  });

  it("9) تفعيل ناجح ينتقل إلى authenticated", async () => {
    resolveTeacherAccessMock
      .mockResolvedValueOnce({ status: "activation-required" })
      .mockResolvedValueOnce({ status: "authenticated", session: sampleSession });
    setupTeacherMock.mockResolvedValue(sampleSession);

    render(<TeacherAuthGate><HomeMarker /></TeacherAuthGate>);
    await waitFor(() => { screen.getByText("تفعيل نسخة المعلم"); });

    fireEvent.change(screen.getByLabelText("الرقم الوزاري"), { target: { value: "2002" } });
    fireEvent.change(screen.getByLabelText("الاسم"), { target: { value: "أ. نورة" } });
    fireEvent.change(screen.getByLabelText("رمز تفعيل المعلم"), { target: { value: "VALID_CODE" } });
    fireEvent.change(screen.getByLabelText("PIN (6 أرقام)"), { target: { value: "246810" } });
    fireEvent.change(screen.getByLabelText("تأكيد PIN"), { target: { value: "246810" } });
    fireEvent.click(screen.getByRole("button", { name: "تفعيل" }));

    await waitFor(() => { screen.getByTestId("teacher-home-marker"); });
    expect(setupTeacherMock).toHaveBeenCalledWith({ activationCredential: "VALID_CODE", schoolId: "2002", stage: "elementary", displayName: "أ. نورة", pin: "246810", confirmPin: "246810" });
    cleanup();
  });
});
