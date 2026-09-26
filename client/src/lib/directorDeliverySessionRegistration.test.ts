// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCanonical16ByteToken, generateCanonical32ByteToken, computeRawSha256Verifier } from "./relayUploadCapabilityCrypto";

if (typeof window !== "undefined" && !window.indexedDB) {
  (window as unknown as { indexedDB: IDBFactory }).indexedDB = globalThis.indexedDB;
}

const RECIPIENT_DB = "khabir-director-recipient-profile-local";
const RELAY_AUTH_DB = "khabir-director-relay-auth-local";
const resetDb = (name: string) => new Promise<void>((resolve) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve(); request.onerror = () => resolve(); request.onblocked = () => resolve();
});
beforeEach(async () => { await resetDb(RECIPIENT_DB); await resetDb(RELAY_AUTH_DB); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterEach(async () => { await resetDb(RECIPIENT_DB); await resetDb(RELAY_AUTH_DB); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const successBody = (status: "created" | "unchanged") => JSON.stringify({ ok: true, data: { status } });

describe("PHASE NEXT-2E-B2-A2-B: directorDeliverySessionRegistration", () => {
  it("C) 201 -> created", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(successBody("created"), { status: 201 })));
    const { registerDeliverySession } = await import("./directorDeliverySessionRegistration");
    const outcome = await registerDeliverySession({ capabilityId: generateCanonical16ByteToken(), sessionId: generateCanonical16ByteToken(), deliveryProofVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(outcome).toEqual({ status: "created" });
  });

  it("C) صفر deliveryProof وصفر capabilitySecret في الطلب — فقط deliveryProofVerifier، أسماء حقول مطابقة حرفيًا", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(successBody("created"), { status: 201 }); }));
    const { registerDeliverySession } = await import("./directorDeliverySessionRegistration");
    const capabilityId = generateCanonical16ByteToken();
    const sessionId = generateCanonical16ByteToken();
    const deliveryProofVerifier = await computeRawSha256Verifier(generateCanonical32ByteToken());
    await registerDeliverySession({ capabilityId, sessionId, deliveryProofVerifier });

    const parsed = JSON.parse(sentBody as string);
    expect(Object.keys(parsed).sort()).toEqual(["capabilityId", "deliveryProofVerifier", "recipientId", "sessionId"]);
    expect(JSON.stringify(parsed)).not.toContain("deliveryProof\"");
    expect(JSON.stringify(parsed)).not.toContain("capabilitySecret");
  });

  it("C) موقَّع فعليًا، URL دقيق /relay-delivery-sessions", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let calledUrl: string | undefined;
    let calledHeaders: Record<string, string> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calledUrl = url; calledHeaders = init.headers as Record<string, string>; return new Response(successBody("created"), { status: 201 }); }));
    const { registerDeliverySession } = await import("./directorDeliverySessionRegistration");
    await registerDeliverySession({ capabilityId: generateCanonical16ByteToken(), sessionId: generateCanonical16ByteToken(), deliveryProofVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });

    expect(calledUrl).toBe("https://backend.example/relay-delivery-sessions");
    expect(typeof calledHeaders?.["X-Relay-Signature"]).toBe("string");
  });

  it("C) 409 -> conflict", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    const { registerDeliverySession } = await import("./directorDeliverySessionRegistration");
    const outcome = await registerDeliverySession({ capabilityId: generateCanonical16ByteToken(), sessionId: generateCanonical16ByteToken(), deliveryProofVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(outcome).toEqual({ status: "conflict" });
  });

  it("C) 10 دقائق سلطتها الخادم — صفر expiresAt يُرسَل فعليًا في جسم الطلب (لا الذكر التوثيقي)", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(successBody("created"), { status: 201 }); }));
    const { registerDeliverySession } = await import("./directorDeliverySessionRegistration");
    await registerDeliverySession({ capabilityId: generateCanonical16ByteToken(), sessionId: generateCanonical16ByteToken(), deliveryProofVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(JSON.parse(sentBody as string)).not.toHaveProperty("expiresAt");
  });
});
