/**
 * PHASE NEXT-2D-D-C + FIX1 â€” Ù†Ù‚Ù„ Ø±Ø§Ø¨Ø·/hash Ø§Ù‚ØªØ±Ø§Ù† Ø§Ù„Ù…Ø¯ÙŠØ±. **Ù…Ø³ØªÙ‚Ù„ ØªÙ…Ø§Ù…Ù‹Ø§**
 * Ø¹Ù† collaborationInvite.ts (Ù†Ø¸Ø§Ù… Ø¯Ø¹ÙˆØ© ØªØ¹Ø§ÙˆÙ† Ù‚Ø¯ÙŠÙ… Ù…ÙØ³ØªØ®Ø¯ÙŽÙ… ÙØ¹Ù„ÙŠÙ‹Ø§ Ù„ØºØ±Ø¶
 * Ø¢Ø®Ø± â€” ØµÙØ± ØªØ¹Ø¯ÙŠÙ„/Ø¯Ù…Ø¬ Ù…Ø¹Ù‡). helper base64url Ø¹Ø§Ù… Ù…ÙØ¹Ø§Ø¯ Ø§Ø³ØªØ®Ø¯Ø§Ù…Ù‡ (Ù…Ø·Ø§Ø¨Ù‚
 * Ø­Ø±ÙÙŠÙ‹Ø§ Ù„Ù„Ù†Ù…Ø· Ø§Ù„Ù…ÙˆØ¬ÙˆØ¯ Ø¨Ø§Ù„ÙØ¹Ù„ ÙÙŠ directorPairingPayload.ts â€” Ø§Ø³ØªØ®Ø¯Ø§Ù…
 * Ù…Ø´Ø±ÙˆØ¹ Ù„Ø£Ù†Ù‡ Ø¹Ø§Ù… ØªÙ…Ø§Ù…Ù‹Ø§ØŒ ØªØ±Ù…ÙŠØ² Ù†ØµÙˆØµ ÙÙ‚Ø·ØŒ Ø¨Ù„Ø§ Ø³ÙŠÙ…Ø§Ù†ØªÙŠÙƒ Ø£Ù…Ù†ÙŠ).
 *
 * Ø§Ù„Ø­Ù…ÙˆÙ„Ø© ØªÙÙ†Ù‚ÙŽÙ„ Ø­ØµØ±Ù‹Ø§ Ø¹Ø¨Ø± URL hash (`#pair-director=...`)ØŒ **Ù„Ø§** query
 * string â€” Ø§Ù„Ù€hash Ù„Ø§ ÙŠÙØ±Ø³ÙŽÙ„ Ù„Ù„Ø®Ø§Ø¯Ù… Ø£Ø¨Ø¯Ù‹Ø§ ÙÙŠ Ø£ÙŠ Ø·Ù„Ø¨ HTTP Ø¹Ø§Ø¯ÙŠ.
 *
 * PHASE FIX1 â€” Ø±Ø§Ø¨Ø· Ø§Ù„Ø§Ù‚ØªØ±Ø§Ù† ÙŠØ¬Ø¨ Ø£Ù† ÙŠØ³ØªÙ‡Ø¯Ù **Ø¬Ø°Ø± Ù…Ø³Ø§Ø± Ø§Ù„Ù…Ø¹Ù„Ù…** Ø¯ÙˆÙ…Ù‹Ø§ØŒ
 * Ø¨ØµØ±Ù Ø§Ù„Ù†Ø¸Ø± Ø¹Ù† Ø§Ù„Ù…Ø³Ø§Ø± Ø§Ù„Ø°ÙŠ ÙˆÙÙ„ÙÙ‘Ø¯ Ù…Ù†Ù‡ ÙØ¹Ù„ÙŠÙ‹Ø§ (Ø§Ù„Ù…Ø¯ÙŠØ± Ø¹Ù„Ù‰ `/director`ØŒ
 * Ø§Ù„Ù…Ø¹Ù„Ù… Ø¹Ù„Ù‰ `/`) â€” ÙˆØ¥Ù„Ø§ ÙŠÙØªØ­ Ø±Ø§Ø¨Ø· Ø§Ù„Ù…ÙÙ†Ø´ÙŽØ£ Ù…Ù† Ø¯Ø§Ø®Ù„ Ù…Ø³Ø§Ø­Ø© Ø§Ù„Ù…Ø¯ÙŠØ± Ù…Ø³Ø§Ø­Ø©
 * Ø§Ù„Ù…Ø¯ÙŠØ± Ù†ÙØ³Ù‡Ø§ Ø¨Ø§Ù„Ø®Ø·Ø£ØŒ Ù„Ø§ Ø´Ø§Ø´Ø© ØªØ£ÙƒÙŠØ¯ Ø§Ù„Ù…Ø¹Ù„Ù…. `import.meta.env.BASE_URL`
 * (Ù„Ø§ `"/"` Ø«Ø§Ø¨ØªØ©) ÙŠÙØ³ØªØ®Ø¯ÙŽÙ… Ø¹Ù…Ø¯Ù‹Ø§ â€” ÙŠØ¨Ù‚Ù‰ ØµØ­ÙŠØ­Ù‹Ø§ Ø³ÙˆØ§Ø¡ Ø¨Ù‚ÙŠ Ø§Ù„Ù†Ø´Ø± Ø¹Ù„Ù‰ Ø¬Ø°Ø±
 * Ø§Ù„Ø¯ÙˆÙ…ÙŠÙ† Ø£Ùˆ Ø§Ù†ØªÙ‚Ù„ Ù„Ø§Ø­Ù‚Ù‹Ø§ Ù„Ù…Ø³Ø§Ø± ÙØ±Ø¹ÙŠ (Ù…Ø«Ù„ GitHub Pages)ØŒ Ù„Ø£Ù† Vite ÙŠØ¶Ø¨Ø·
 * Ù‡Ø°Ù‡ Ø§Ù„Ù‚ÙŠÙ…Ø© ØªÙ„Ù‚Ø§Ø¦ÙŠÙ‹Ø§ ÙˆÙÙ‚ `base` Ø§Ù„ÙØ¹Ù„ÙŠØ© ÙˆÙ‚Øª Ø§Ù„Ø¨Ù†Ø§Ø¡.
 */

const HASH_KEY = "pair-director";

/** Ø¬Ø°Ø± ØªØ·Ø¨ÙŠÙ‚ Ø§Ù„Ù…Ø¹Ù„Ù… Ø¹Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ù†Ø´Ø±/Ø§Ù„Ø£ØµÙ„ â€” ÙŠØ­ØªØ±Ù… Ø£ÙŠ Ù…Ø³Ø§Ø± ÙØ±Ø¹ÙŠ Ù„Ù„Ø¨Ù†Ø§Ø¡. */
const buildTeacherRootUrl = (): URL => {
  const url = new URL(window.location.href);
  url.pathname = import.meta.env.BASE_URL;
  url.search = "";
  url.hash = "";
  return url;
};

export const buildDirectorPairingUrl = (encodedToken: string): string => {
  const url = buildTeacherRootUrl();
  url.hash = `${HASH_KEY}=${encodedToken}`;
  return url.toString();
};

export type PairingHashParseResult =
  | { kind: "none" }
  | { kind: "token"; token: string }
  | { kind: "malformed" };

/**
 * PHASE FIX2 â€” ÙŠÙ…ÙŠÙÙ‘Ø² ØµØ±Ø§Ø­Ø© Ø¨ÙŠÙ† Ø«Ù„Ø§Ø« Ø­Ø§Ù„Ø§Øª:
 *   none: Ø§Ù„Ù€hash ØºØ§Ø¦Ø¨ ØªÙ…Ø§Ù…Ù‹Ø§ Ø£Ùˆ ÙŠØ®Øµ Ù…ÙŠØ²Ø© Ø£Ø®Ø±Ù‰ (Ù…Ø«Ù„ collaborationInvite.ts) â€” ÙŠÙØªØ¬Ø§Ù‡ÙŽÙ„ Ø¨ØµÙ…Øª ØªÙ…Ø§Ù…Ù‹Ø§
 *   token: hash Ø§Ù‚ØªØ±Ø§Ù† ØµØ§Ù„Ø­ Ø§Ù„Ø´ÙƒÙ„ØŒ ÙŠØ­Ù…Ù„ ØªÙˆÙƒÙ†Ù‹Ø§ ÙØ¹Ù„ÙŠÙ‹Ø§
 *   malformed: hash Ø§Ù‚ØªØ±Ø§Ù† **Ù…ÙˆØ¬ÙˆØ¯ Ù„ÙƒÙ† ÙØ§Ø±Øº/ØªØ§Ù„Ù** (Ù…Ø«Ù„ `#pair-director=`)
 *     â€” ÙŠØ¬Ø¨ Ø£Ù† ÙŠÙØ´ØºÙÙ‘Ù„ ØªØ¯ÙÙ‚ Ø§Ù„Ø§Ù‚ØªØ±Ø§Ù† Ù„ÙŠØ¹Ø±Ø¶ Ø®Ø·Ø£Ù‹ ØµØ±ÙŠØ­Ù‹Ø§ Ù‚Ø§Ø¨Ù„Ù‹Ø§ Ù„Ù„Ø¥ØºÙ„Ø§Ù‚ØŒ
 *     Ù„Ø§ Ø£Ù† ÙŠÙØ¹Ø§Ù…ÙŽÙ„ ÙˆÙƒØ£Ù† ØµÙØ± Ø±Ø§Ø¨Ø· Ø§Ù‚ØªØ±Ø§Ù† Ù…ÙˆØ¬ÙˆØ¯ Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§.
 */
export const parsePairingHashFromLocation = (): PairingHashParseResult => {
  const rawHash = window.location.hash.replace(/^#/, "");
  if (!rawHash.startsWith(`${HASH_KEY}=`)) return { kind: "none" };
  const rawToken = rawHash.slice(`${HASH_KEY}=`.length);
  if (rawToken.length === 0) return { kind: "malformed" };
  try {
    const decoded = decodeURIComponent(rawToken);
    if (decoded.length === 0) return { kind: "malformed" };
    return { kind: "token", token: decoded };
  } catch {
    return { kind: "malformed" }; // decodeURIComponent Ù†ÙØ³Ù‡Ø§ Ù‚Ø¯ ØªØ±Ù…ÙŠ Ù„Ø³Ù„Ø³Ù„Ø© % Ù…ÙØ´ÙˆÙŽÙ‘Ù‡Ø©
  }
};

/**
 * ØªÙ†Ø¸ÙŠÙ Ø§Ù„Ù€hash â€” ÙŠØ¹Ù…Ù„ Ø§Ù„Ø¢Ù† Ù„Ø­Ø§Ù„ØªÙŽÙŠ "token" Ùˆ"malformed" Ù…Ø¹Ù‹Ø§ (Ø§Ù„Ø¥ØµÙ„Ø§Ø­
 * Ø§Ù„Ø¬ÙˆÙ‡Ø±ÙŠ Ù„Ù€FIX2: hash ÙØ§Ø±Øº `#pair-director=` ÙƒØ§Ù† ÙŠÙÙ…Ù†ÙŽØ¹ Ù…Ù† Ø§Ù„ØªÙ†Ø¸ÙŠÙ
 * Ø³Ø§Ø¨Ù‚Ù‹Ø§ Ù„Ø£Ù† Ø§Ù„ÙØ­Øµ Ø§Ù„Ù‚Ø¯ÙŠÙ… Ø§Ø¹ØªÙ…Ø¯ Ø¹Ù„Ù‰ ÙˆØ¬ÙˆØ¯ ØªÙˆÙƒÙ† ØºÙŠØ± ÙØ§Ø±Øº ÙÙ‚Ø·). hash ØºÙŠØ±
 * Ø°ÙŠ ØµÙ„Ø© (kind="none") ÙŠØ¨Ù‚Ù‰ Ø¨Ù„Ø§ Ù„Ù…Ø³ ØªÙ…Ø§Ù…Ù‹Ø§.
 */
export const clearPairingHashFromLocation = (): void => {
  const parsed = parsePairingHashFromLocation();
  if (parsed.kind === "none") return;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
};

/**
 * PHASE NEXT-2D-D-C-FIX2 â€” Ø§Ø³ØªÙ…Ø±Ø§Ø±ÙŠØ© Ù†ÙŠØ© Ø§Ù„Ø§Ù‚ØªØ±Ø§Ù† Ø¹Ø¨Ø± onboarding Ø§Ù„Ù…Ø¹Ù„Ù….
 *
 * Ø§Ù„Ø³Ø¨Ø¨ Ø§Ù„Ø¬Ø°Ø±ÙŠ Ø§Ù„Ù…ÙØ«Ø¨ÙŽØª Ù…Ù† Ù‚Ø±Ø§Ø¡Ø© App.tsx/TeacherAuthGate.tsx Ø§Ù„ÙØ¹Ù„ÙŠØ©:
 * TeacherAuthGate ØªÙØ­ÙŠØ· Ø¨Ù€Home ÙƒÙ€`children` â€” Home.tsx **Ù„Ø§ ØªÙØ±ÙƒÙŽÙ‘Ø¨ ÙÙŠ DOM
 * Ø¥Ø·Ù„Ø§Ù‚Ù‹Ø§** Ø£Ø«Ù†Ø§Ø¡ Ø¹Ø±Ø¶ Ø´Ø§Ø´Ø© onboarding/PINØŒ ÙÙ‚Ø±Ø§Ø¡Ø© location.hash Ø¯Ø§Ø®Ù„
 * useState Ø§Ù„Ø£ÙˆÙ„ÙŠ Ù„Ù€Home Ù„Ø§ ØªÙØ´ØºÙŽÙ‘Ù„ Ø¥Ù„Ø§ Ø¨Ø¹Ø¯ Ù†Ø¬Ø§Ø­ Ø§Ù„Ù…ØµØ§Ø¯Ù‚Ø©/onboarding
 * Ù„Ø£ÙˆÙ„ Ù…Ø±Ø©. Ø§Ù„Ø­Ù„ Ø§Ù„Ø£ØµÙ„Ø¨: Ø§Ù„ØªÙ‚Ø§Ø· Ø§Ù„Ù†ÙŠØ© Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø© Ø¹Ù†Ø¯ Ø£Ø¹Ù„Ù‰ Ù†Ù‚Ø·Ø© ØªØ­Ù…ÙŠÙ„
 * Ù…Ù…ÙƒÙ†Ø© (App.tsxØŒ Ù‚Ø¨Ù„ TeacherAuthGate)ØŒ Ø­ÙØ¸Ù‡Ø§ ÙÙŠ sessionStorage (Ù†Ø·Ø§Ù‚
 * Ø§Ù„ØªØ¨ÙˆÙŠØ¨/Ø§Ù„Ø¬Ù„Ø³Ø© ÙÙ‚Ø· â€” Ø¹Ø§Ø¨Ø±Ø© Ø¨Ø·Ø¨ÙŠØ¹ØªÙ‡Ø§ØŒ Ù„Ø§ Ø¨ÙŠØ§Ù†Ø§Øª Ø¯Ø§Ø¦Ù…Ø©)ØŒ Ø«Ù… Ø§Ø³ØªÙ‡Ù„Ø§ÙƒÙ‡Ø§
 * Ù„Ø§Ø­Ù‚Ù‹Ø§ Ù…Ù† Home.tsx Ø¨ØµØ±Ù Ø§Ù„Ù†Ø¸Ø± Ø¹Ù† ØªÙˆÙ‚ÙŠØª ØªØ±ÙƒÙŠØ¨Ù‡Ø§ Ø§Ù„ÙØ¹Ù„ÙŠ.
 *
 * ØµÙØ± ØªØºÙŠÙŠØ± Ø¹Ù„Ù‰ Ø§Ù„Ø³Ù„ÙˆÙƒ Ø§Ù„Ø£Ù…Ù†ÙŠ: ØµÙØ± pairRecipient Ø­ØªÙ‰ Ø§Ù„Ø¢Ù†ØŒ ÙÙ‚Ø· Ø­ÙØ¸ Ù†Øµ
 * Ø§Ù„ØªÙˆÙƒÙ†/Ø­Ø§Ù„Ø© malformed Ù…Ø­Ù„ÙŠÙ‹Ø§ Ù…Ø¤Ù‚ØªÙ‹Ø§ Ù„Ø­ÙŠÙ† ÙˆØµÙˆÙ„ Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ù„Ø´Ø§Ø´Ø© Ø§Ù„ØªØ£ÙƒÙŠØ¯.
 */
const PENDING_PAIRING_STORAGE_KEY = "khabir-pending-director-pairing";

/** ÙŠÙØ³ØªØ¯Ø¹Ù‰ Ù…Ø±Ø© ÙˆØ§Ø­Ø¯Ø© Ø¹Ù†Ø¯ Ø£Ø¹Ù„Ù‰ Ù†Ù‚Ø·Ø© ØªØ­Ù…ÙŠÙ„ Ù…Ù…ÙƒÙ†Ø© (App.tsx) â€” Ù‚Ø¨Ù„ Ø£ÙŠ Ø¨ÙˆØ§Ø¨Ø© Ù…ØµØ§Ø¯Ù‚Ø©. */
export const capturePendingPairingIntent = (): void => {
  const parsed = parsePairingHashFromLocation();
  if (parsed.kind === "none") return;
  try {
    window.sessionStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify(parsed));
  } catch { /* sessionStorage ØºÙŠØ± Ù…ØªØ§Ø­ (ÙˆØ¶Ø¹ Ø®Ø§Øµ/ØªÙ‚ÙŠÙŠØ¯ Ù…ØªØµÙØ­) â€” Ø§Ù„Ø³Ù‚ÙˆØ· Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ Ù„Ù‚Ø±Ø§Ø¡Ø© hash Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø© ÙŠØ¨Ù‚Ù‰ ÙŠØ¹Ù…Ù„ */ }
};

/**
 * ØªÙØ³ØªØ¯Ø¹Ù‰ Ù…Ù† Home.tsx â€” ØªÙ‚Ø±Ø£ Ø§Ù„Ù†ÙŠØ© Ø§Ù„Ù…Ø­ÙÙˆØ¸Ø© Ø£ÙˆÙ„Ù‹Ø§ (ØªÙØºØ·ÙÙ‘ÙŠ Ø­Ø§Ù„Ø© onboarding
 * Ø§Ù„Ø·ÙˆÙŠÙ„)ØŒ ÙˆØ¥Ù„Ø§ ØªØ³Ù‚Ø· Ù„Ù‚Ø±Ø§Ø¡Ø© location.hash Ù…Ø¨Ø§Ø´Ø±Ø© (ÙŠÙØºØ·ÙÙ‘ÙŠ Ø§Ù„Ù…Ø¹Ù„Ù…
 * Ø§Ù„Ù…ÙÙ‡ÙŠÙŽÙ‘Ø£ Ø¨Ø§Ù„ÙØ¹Ù„ Ø§Ù„Ø°ÙŠ Ù„Ø§ onboarding ÙŠØ¹ØªØ±Ø¶ ØªØ±ÙƒÙŠØ¨ Home Ø£ØµÙ„Ù‹Ø§).
 */
/**
 * PHASE FIX2.1 â€” Ù…ÙØ¯Ù‚ÙÙ‘Ù‚ runtime ØµØ±ÙŠØ­ Ù„Ø¨ÙŠØ§Ù†Ø§Øª sessionStorage Ø§Ù„Ù…ÙØ®Ø²ÙŽÙ‘Ù†Ø© â€”
 * `JSON.parse(...) as PairingHashParseResult` ÙˆØ­Ø¯Ù‡Ø§ Ù„Ø§ ØªÙØ´ÙƒÙÙ‘Ù„ Ø­Ø¯Ù‹Ù‘Ø§
 * Ø£Ù…Ù†ÙŠÙ‹Ø§ ÙØ¹Ù„ÙŠÙ‹Ø§ (ØªØ£ÙƒÙŠØ¯ Ù†ÙˆØ¹ TypeScript ÙÙ‚Ø·ØŒ Ù„Ø§ ÙØ­ØµÙ‹Ø§ ÙˆÙ‚Øª Ø§Ù„ØªØ´ØºÙŠÙ„). Ø£ÙŠ Ø´ÙƒÙ„
 * ØºÙŠØ± Ù…Ø·Ø§Ø¨Ù‚ Ø­Ø±ÙÙŠÙ‹Ø§ ÙŠÙØ±ÙÙŽØ¶Ø› Ø§Ù„Ù†Ø§ØªØ¬ Ø§Ù„Ù…Ù‚Ø¨ÙˆÙ„ ÙŠÙØ¹Ø§Ø¯ **Ø¨Ù†Ø§Ø¤Ù‡ Ù…Ù† Ø§Ù„ØµÙØ±** Ù…Ù†
 * Ø§Ù„Ø­Ù‚ÙˆÙ„ Ø§Ù„Ù…ÙØªØ­Ù‚ÙŽÙ‘Ù‚ Ù…Ù†Ù‡Ø§ (Ù„Ø§ Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ÙƒØ§Ø¦Ù† Ø§Ù„Ù…ÙØ­Ù„ÙŽÙ‘Ù„ Ù…Ø¨Ø§Ø´Ø±Ø©).
 */
const parseStoredPendingIntent = (raw: string): PairingHashParseResult | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;

  if (candidate.kind === "malformed") return { kind: "malformed" };
  if (candidate.kind === "token") {
    if (typeof candidate.token !== "string" || candidate.token.length === 0) return null;
    return { kind: "token", token: candidate.token };
  }
  return null; // "none" Ø£Ùˆ Ø£ÙŠ kind Ø¢Ø®Ø± â€” ØµÙØ± Ø³Ø¨Ø¨ Ù„ØªØ®Ø²ÙŠÙ† "none" Ø£ØµÙ„Ù‹Ø§ØŒ ÙˆØ£ÙŠ Ù‚ÙŠÙ…Ø© ØºÙŠØ± Ù…Ø¹Ø±ÙˆÙØ© ØªÙØ±ÙÙŽØ¶
};

export const consumePendingPairingIntent = (): PairingHashParseResult => {
  try {
    const stored = window.sessionStorage.getItem(PENDING_PAIRING_STORAGE_KEY);
    if (stored) {
      const validated = parseStoredPendingIntent(stored);
      if (validated) return validated;
      // Ø¨ÙŠØ§Ù†Ø§Øª Ù…ÙØ®Ø²ÙŽÙ‘Ù†Ø© ØªØ§Ù„ÙØ©/ØºÙŠØ± Ù…ØªÙˆÙ‚ÙŽÙ‘Ø¹Ø© â€” Ø¥Ø²Ø§Ù„ØªÙ‡Ø§ ÙÙˆØ±Ù‹Ø§ØŒ ØµÙØ± Ø±Ù…ÙŠ Ø§Ø³ØªØ«Ù†Ø§Ø¡ØŒ ØµÙØ± Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù‚ØªØ±Ø§Ù†
      try { window.sessionStorage.removeItem(PENDING_PAIRING_STORAGE_KEY); } catch { /* ØªØ¬Ø§Ù‡Ù„ */ }
    }
  } catch { /* ØªØ¬Ø§Ù‡Ù„ â€” Ø³Ù‚ÙˆØ· Ø§Ø­ØªÙŠØ§Ø·ÙŠ Ø£Ø¯Ù†Ø§Ù‡ */ }
  return parsePairingHashFromLocation();
};

/** ÙŠÙØ³ØªØ¯Ø¹Ù‰ Ø¹Ù†Ø¯ Ù†Ø¬Ø§Ø­/Ø¥Ù„ØºØ§Ø¡ ØµØ±ÙŠØ­ â€” ÙŠÙ…Ø³Ø­ ÙƒÙ„Ø§ Ù…ØµØ¯Ø±ÙŽÙŠ Ø§Ù„Ù†ÙŠØ© (sessionStorage + hash). */
export const clearPendingPairingIntent = (): void => {
  try { window.sessionStorage.removeItem(PENDING_PAIRING_STORAGE_KEY); } catch { /* ØªØ¬Ø§Ù‡Ù„ */ }
  clearPairingHashFromLocation();
};
