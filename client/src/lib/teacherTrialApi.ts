export type TeacherTrialEnrollmentResponse = {
  accountId: string;
  signedCode: string;
};

const getLicenseBackendUrl = (): string => {
  const value = import.meta.env.VITE_LICENSE_BACKEND_URL;

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("license_backend_url_required");
  }

  return value.replace(/\/+$/, "");
};

export const requestTeacherTrialEnrollment = async (
  deviceId: string,
): Promise<TeacherTrialEnrollmentResponse> => {
  if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
    throw new Error("device_id_required");
  }

  const response = await fetch(
    `${getLicenseBackendUrl()}/api/teacher/trial`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceId }),
    },
  );

  if (!response.ok) {
    throw new Error("teacher_trial_enrollment_failed");
  }

  const body: unknown = await response.json();

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).accountId !== "string" ||
    typeof (body as Record<string, unknown>).signedCode !== "string" ||
    ((body as Record<string, unknown>).accountId as string).length === 0 ||
    ((body as Record<string, unknown>).signedCode as string).length === 0
  ) {
    throw new Error("teacher_trial_response_invalid");
  }

  return {
    accountId: (body as Record<string, string>).accountId,
    signedCode: (body as Record<string, string>).signedCode,
  };
};
