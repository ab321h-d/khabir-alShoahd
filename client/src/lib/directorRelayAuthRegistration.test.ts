// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** يطابق عقد استجابة الخادم الفعلي المؤكَّد من functions/httpFoundation.mjs's ok(). */
const successBody = (status: "created" | "unchanged") => JSON.stringify({ ok: true, data: { status } });

describe("PHASE NEXT-2E-B1B: directorRelayAuthRegistration", () => {
  it("8) 201 + عقد استجابة صحيح -> {status:'created'}", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(successBody("created"), { status: 201 })));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "created" });
  });

  it("4) 201 لكن body لا يطابق العقد المتوقَّع (data.status خاطئ) -> {status:'malformed_response'} — status code وحده غير كافٍ", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(successBody("unchanged"), { status: 201 }))); // status=201 لكن data.status="unchanged" — عدم تطابق
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "malformed_response" });
  });

  it("4) 201 بجسم غير قابل للتحليل (JSON مُشوَّه) -> {status:'malformed_response'}", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{not-valid-json", { status: 201 })));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "malformed_response" });
  });

  it("8) 200 + عقد استجابة صحيح -> {status:'unchanged'}", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(successBody("unchanged"), { status: 200 })));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "unchanged" });
  });

  it("8) 409 -> {status:'conflict'}", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "conflict" });
  });

  it("3) 409: كلا recipientId ومفتاح relay-auth العام (x/y) يبقيان ثابتَين تمامًا قبل/بعد — صفر دوران/استبدال لأي منهما", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 409 })));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const { getOrCreateDirectorRelayAuthPublicKey } = await import("./directorRelayAuthIdentity");
    const { getOrCreateDirectorRecipientProfile } = await import("./directorRecipientProfile");

    const recipientProfileBefore = await getOrCreateDirectorRecipientProfile();
    const publicKeyBefore = await getOrCreateDirectorRelayAuthPublicKey();

    const outcome = await registerDirectorRelayAuthKey();

    const recipientProfileAfter = await getOrCreateDirectorRecipientProfile();
    const publicKeyAfter = await getOrCreateDirectorRelayAuthPublicKey();

    expect(outcome).toEqual({ status: "conflict" });
    expect(recipientProfileAfter.recipientId).toBe(recipientProfileBefore.recipientId);
    expect(publicKeyAfter.x).toBe(publicKeyBefore.x);
    expect(publicKeyAfter.y).toBe(publicKeyBefore.y);
  });

  it("8) فشل شبكة -> {status:'network_error'}", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "network_error" });
  });

  it("8) VITE_LICENSE_BACKEND_URL غائبة -> {status:'config_error'}، صفر استدعاء fetch", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "");
    const fetchSpy = vi.fn(async () => new Response(successBody("created"), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "config_error" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("8) استجابة غير متوقَّعة (مثلًا 500) -> {status:'malformed_response'}", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const outcome = await registerDirectorRelayAuthKey();
    expect(outcome).toEqual({ status: "malformed_response" });
  });

  it("5) recipientId يأتي حصرًا من getOrCreateDirectorRecipientProfile — الطلب المُرسَل يحمل نفس recipientId المحلي بالضبط", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(successBody("created"), { status: 201 }); }));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    const { getOrCreateDirectorRecipientProfile } = await import("./directorRecipientProfile");

    const profile = await getOrCreateDirectorRecipientProfile();
    await registerDirectorRelayAuthKey();

    expect(sentBody).toBeDefined();
    const parsed = JSON.parse(sentBody as string);
    expect(parsed.recipientId).toBe(profile.recipientId);
  });

  it("5) أسماء حقول الجسم مطابقة حرفيًا للعقد الفعلي للخادم: {recipientId, relayAuthPublicKeyJwk} فقط — صفر حقل زائد", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let sentBody: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { sentBody = init.body as string; return new Response(successBody("created"), { status: 201 }); }));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    await registerDirectorRelayAuthKey();
    const parsed = JSON.parse(sentBody as string);
    expect(Object.keys(parsed).sort()).toEqual(["recipientId", "relayAuthPublicKeyJwk"]);
  });

  it("1) الطلب يُرسَل إلى POST /relay-auth/register بالضبط، Content-Type فقط — صفر header توقيع X-Relay-* (مؤكَّد: endpoint غير موقَّعة فعليًا في الخادم)", async () => {
    vi.stubEnv("VITE_LICENSE_BACKEND_URL", "https://backend.example");
    let calledUrl: string | undefined;
    let calledInit: RequestInit | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calledUrl = url; calledInit = init; return new Response(successBody("created"), { status: 201 }); }));
    const { registerDirectorRelayAuthKey } = await import("./directorRelayAuthRegistration");
    await registerDirectorRelayAuthKey();

    expect(calledUrl).toBe("https://backend.example/relay-auth/register");
    expect(calledInit?.method).toBe("POST");
    const headers = calledInit?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Relay-Timestamp"]).toBeUndefined();
    expect(headers["X-Relay-Nonce"]).toBeUndefined();
    expect(headers["X-Relay-Signature"]).toBeUndefined();
  });

  it("1) فحص بنيوي: صفر import فعلي لـbuildSignedRelayRequest/directorRelaySignedRequest في ملف التسجيل (التعليق التوثيقي الذي يشرح القرار لا يُحتسَب)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRelayAuthRegistration.ts"), "utf-8");
    expect(source).not.toMatch(/^import .*(directorRelaySignedRequest)/m);
    expect(source).not.toContain("buildSignedRelayRequest(");
  });

  it("صفر تخزين محلي لعلامة 'registered=true' — فحص بنيوي: صفر localStorage.setItem/sessionStorage.setItem في الملف", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRelayAuthRegistration.ts"), "utf-8");
    expect(source).not.toContain("localStorage.setItem");
    expect(source).not.toContain("sessionStorage.setItem");
    expect(source).not.toContain("localStorage.getItem");
    expect(source).not.toContain("sessionStorage.getItem");
  });

  it("صفر ربط بـdirectorTrustRegistry/schoolId (فحص بنيوي)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "directorRelayAuthRegistration.ts"), "utf-8");
    expect(source).not.toContain("directorTrustRegistry");
    expect(source).not.toMatch(/schoolId/);
  });
});
