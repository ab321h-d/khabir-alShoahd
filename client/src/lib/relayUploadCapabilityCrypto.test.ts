// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  generateCanonical16ByteToken,
  generateCanonical32ByteToken,
  computeRawSha256Verifier,
  decodeCanonicalBase64UrlExactLength,
  isValidCanonical16ByteToken,
  isValidCanonical32ByteToken,
} from "./relayUploadCapabilityCrypto";

describe("PHASE NEXT-2E-B2-A2-B: relayUploadCapabilityCrypto", () => {
  it("A) توكن 16 بايت -> 22 حرفًا canonical", () => {
    const token = generateCanonical16ByteToken();
    expect(token.length).toBe(22);
    expect(isValidCanonical16ByteToken(token)).toBe(true);
    expect(token).not.toBe(generateCanonical16ByteToken());
  });

  it("A) توكن 32 بايت -> 43 حرفًا canonical", () => {
    const token = generateCanonical32ByteToken();
    expect(token.length).toBe(43);
    expect(isValidCanonical32ByteToken(token)).toBe(true);
    expect(token).not.toBe(generateCanonical32ByteToken());
  });

  it("A) verifier = SHA-256 على البايتات الخام المُفكَّكة، لا النص UTF-8 للتمثيل المُرمَّز", async () => {
    const token = generateCanonical32ByteToken();
    const verifier = await computeRawSha256Verifier(token);
    expect(verifier.length).toBe(43);
    expect(isValidCanonical32ByteToken(verifier)).toBe(true);

    // إثبات مباشر: الهاش على النص UTF-8 للتمثيل المُرمَّز يُنتِج قيمة مختلفة فعليًا
    const wrongDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const wrongVerifier = btoa(String.fromCharCode(...new Uint8Array(wrongDigest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    expect(verifier).not.toBe(wrongVerifier);
  });

  it("verifier حتمي — نفس التوكن ينتج نفس القيمة دائمًا", async () => {
    const token = generateCanonical32ByteToken();
    const v1 = await computeRawSha256Verifier(token);
    const v2 = await computeRawSha256Verifier(token);
    expect(v1).toBe(v2);
  });

  it("توكن مختلف ينتج verifier مختلفًا", async () => {
    const v1 = await computeRawSha256Verifier(generateCanonical32ByteToken());
    const v2 = await computeRawSha256Verifier(generateCanonical32ByteToken());
    expect(v1).not.toBe(v2);
  });

  it("decodeCanonicalBase64UrlExactLength يرفض طولًا خاطئًا/padding/أبجدية غير صالحة", () => {
    expect(decodeCanonicalBase64UrlExactLength("too-short", 16)).toBeNull();
    expect(decodeCanonicalBase64UrlExactLength(generateCanonical16ByteToken() + "=", 16)).toBeNull();
    expect(decodeCanonicalBase64UrlExactLength("AAAAAAAAAAAAAAAAAAAAAA+/", 16)).toBeNull();
  });

  it("isValidCanonical16ByteToken/isValidCanonical32ByteToken يرفضان طول الآخر", () => {
    expect(isValidCanonical16ByteToken(generateCanonical32ByteToken())).toBe(false);
    expect(isValidCanonical32ByteToken(generateCanonical16ByteToken())).toBe(false);
  });
});
