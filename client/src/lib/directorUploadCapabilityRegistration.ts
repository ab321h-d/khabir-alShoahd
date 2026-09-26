/**
 * PHASE NEXT-2E-B2-A2-B — POST /relay-upload-capabilities. موقَّع
 * relay-auth (نفس buildSignedRelayRequest الجاهزة من B1B). **صفر
 * capabilitySecret يُرسَل هنا إطلاقًا** — فقط capabilityVerifier
 * (مُشتَق مسبقًا على العميل عبر computeRawSha256Verifier).
 */
import { getOrCreateDirectorRecipientProfile } from "./directorRecipientProfile";
import { buildSignedRelayRequest } from "./directorRelaySignedRequest";

const getLicenseBackendUrl = (): string => {
  const value = import.meta.env.VITE_LICENSE_BACKEND_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("license_backend_url_required");
  }
  return value.replace(/\/+$/, "");
};

export type UploadCapabilityRegistrationOutcome =
  | { status: "created" }
  | { status: "unchanged" }
  | { status: "conflict" }
  | { status: "network_error" }
  | { status: "config_error" }
  | { status: "malformed_response" };

const parseSuccessBody = async (response: Response, expectedStatus: "created" | "unchanged"): Promise<boolean> => {
  try {
    const parsed = await response.json();
    return parsed?.ok === true && parsed?.data?.status === expectedStatus;
  } catch {
    return false;
  }
};

/** 409 (registration_conflict): صفر دوران/استبدال/إعادة محاولة صامتة بهوية مختلفة — تُعاد "conflict" فقط. */
export const registerUploadCapability = async (params: { capabilityId: string; capabilityVerifier: string }): Promise<UploadCapabilityRegistrationOutcome> => {
  let backendUrl: string;
  try {
    backendUrl = getLicenseBackendUrl();
  } catch {
    return { status: "config_error" };
  }

  const recipientProfile = await getOrCreateDirectorRecipientProfile();
  const path = "/relay-upload-capabilities";
  const bodyText = JSON.stringify({ recipientId: recipientProfile.recipientId, capabilityId: params.capabilityId, capabilityVerifier: params.capabilityVerifier });

  const signed = await buildSignedRelayRequest({ method: "POST", path, body: bodyText });

  let response: Response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Timestamp": signed.timestamp,
        "X-Relay-Nonce": signed.nonce,
        "X-Relay-Signature": signed.signatureBase64Url,
      },
      body: bodyText,
    });
  } catch {
    return { status: "network_error" };
  }

  if (response.status === 201) return (await parseSuccessBody(response, "created")) ? { status: "created" } : { status: "malformed_response" };
  if (response.status === 200) return (await parseSuccessBody(response, "unchanged")) ? { status: "unchanged" } : { status: "malformed_response" };
  if (response.status === 409) return { status: "conflict" };
  return { status: "malformed_response" };
};
