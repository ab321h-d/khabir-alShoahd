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

describe("PHASE NEXT-2E-B2-A2-B: directorUploadCapabilityRegistration", () => {
  it("B) 201 -> created", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(successBody("created"), { status: 201 })));
    const { registerUploadCapability } = await import("./directorUploadCapabilityRegistration");
    const outcome = await registerUploadCapability({ capabilityId: generateCanonical16ByteToken(), capabilityVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(outcome).toEqual({ status: "created" });
  });

  it("B) 409 -> conflict، صفر إعادة محاولة تلقائية بهوية مختلفة (طبقة JS فقط تُعيد النتيجة)", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    const { registerUploadCapability } = await import("./directorUploadCapabilityRegistration");
    const outcome = await registerUploadCapability({ capabilityId: generateCanonical16ByteToken(), capabilityVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(outcome).toEqual({ status: "conflict" });
  });

  it("B) صفر capabilitySecret في الطلب — فقط capabilityVerifier، أسماء الحقول مطابقة حرفيًا لعقد الخادم", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(successBody("created"), { status: 201 }); }));
    const { registerUploadCapability } = await import("./directorUploadCapabilityRegistration");
    const capabilityId = generateCanonical16ByteToken();
    const capabilityVerifier = await computeRawSha256Verifier(generateCanonical32ByteToken());
    await registerUploadCapability({ capabilityId, capabilityVerifier });

    const parsed = JSON.parse(sentBody as string);
    expect(Object.keys(parsed).sort()).toEqual(["capabilityId", "capabilityVerifier", "recipientId"]);
    expect(parsed.capabilityId).toBe(capabilityId);
    expect(parsed.capabilityVerifier).toBe(capabilityVerifier);
    expect(JSON.stringify(parsed)).not.toContain("capabilitySecret");
  });

  it("B) الطلب موقَّع فعليًا بمفتاح relay-auth الحالي — headers X-Relay-* موجودة، الطلب لـPOST /relay-upload-capabilities بالضبط", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let calledUrl: string | undefined;
    let calledHeaders: Record<string, string> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calledUrl = url; calledHeaders = init.headers as Record<string, string>; return new Response(successBody("created"), { status: 201 }); }));
    const { registerUploadCapability } = await import("./directorUploadCapabilityRegistration");
    await registerUploadCapability({ capabilityId: generateCanonical16ByteToken(), capabilityVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });

    expect(calledUrl).toBe("https://backend.example/relay-upload-capabilities");
    expect(typeof calledHeaders?.["X-Relay-Timestamp"]).toBe("string");
    expect(typeof calledHeaders?.["X-Relay-Nonce"]).toBe("string");
    expect(typeof calledHeaders?.["X-Relay-Signature"]).toBe("string");
  });

  it("B) VITE_LICENSE_BACKEND_URL غائبة -> config_error، صفر fetch", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "");
    const fetchSpy = vi.fn(async () => new Response(successBody("created"), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { registerUploadCapability } = await import("./directorUploadCapabilityRegistration");
    const outcome = await registerUploadCapability({ capabilityId: generateCanonical16ByteToken(), capabilityVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(outcome).toEqual({ status: "config_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("B) فشل شبكة -> network_error", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { registerUploadCapability } = await import("./directorUploadCapabilityRegistration");
    const outcome = await registerUploadCapability({ capabilityId: generateCanonical16ByteToken(), capabilityVerifier: await computeRawSha256Verifier(generateCanonical32ByteToken()) });
    expect(outcome).toEqual({ status: "network_error" });
  });
});
