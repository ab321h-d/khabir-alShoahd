import { describe, expect, it } from "vitest";
import { escapeHtml } from "./sanitize";

describe("escapeHtml", () => {
  it("escapes text that is inserted into generated local document markup", () => {
    expect(escapeHtml(`<img src=x onerror='alert("x")'> & "نص"`)).toBe("&lt;img src=x onerror=&#39;alert(&quot;x&quot;)&#39;&gt; &amp; &quot;نص&quot;");
  });
});
