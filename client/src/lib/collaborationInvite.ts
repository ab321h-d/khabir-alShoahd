export type CollaborationRole = "teacher" | "director";

export type CollaborationInvite = {
  version: 1 | 2;
  id: string;
  fromRole: CollaborationRole;
  toRole: CollaborationRole;
  senderName: string;
  schoolName: string;
  note: string;
  verificationCode: string;
  createdAt: string;
};

export type CollaborationContact = CollaborationInvite & { acceptedAt: string };

const inviteHashKey = "khabir-invite";
const contactsStorageKey = "khabir-collaboration-contacts.v1";
const maxSenderNameLength = 70;
const maxSchoolNameLength = 90;
const maxNoteLength = 160;
const verificationAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

const isRole = (value: unknown): value is CollaborationRole => value === "teacher" || value === "director";
const isVersion = (value: unknown): value is CollaborationInvite["version"] => value === 1 || value === 2;
const cleanText = (value: unknown, length: number) => typeof value === "string" ? value.trim().slice(0, length) : "";

const base64UrlEncode = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

export const roleLabel = (role: CollaborationRole) => role === "director" ? "مدير/ة مدرسة" : "معلم/ة";

const createVerificationCode = () => {
  const randomValues = new Uint32Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(randomValues);
  else randomValues.forEach((_, index) => { randomValues[index] = Math.floor(Math.random() * 0xffffffff); });
  return Array.from(randomValues, (value) => verificationAlphabet[value % verificationAlphabet.length]).join("");
};

const normalizeInvite = (value: unknown): CollaborationInvite | null => {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<CollaborationInvite>;
  if (!isVersion(parsed.version) || typeof parsed.id !== "string" || !isRole(parsed.fromRole) || !isRole(parsed.toRole) || typeof parsed.createdAt !== "string") return null;
  return {
    version: parsed.version,
    id: parsed.id.slice(0, 100),
    fromRole: parsed.fromRole,
    toRole: parsed.toRole,
    senderName: cleanText(parsed.senderName, maxSenderNameLength),
    schoolName: cleanText(parsed.schoolName, maxSchoolNameLength),
    note: cleanText(parsed.note, maxNoteLength),
    verificationCode: parsed.version === 2 ? cleanText(parsed.verificationCode, 12).toUpperCase() : "",
    createdAt: parsed.createdAt,
  };
};

export function createCollaborationInvite(input: Pick<CollaborationInvite, "fromRole" | "toRole" | "senderName" | "note"> & Partial<Pick<CollaborationInvite, "schoolName">>): CollaborationInvite {
  return {
    version: 2,
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    fromRole: input.fromRole,
    toRole: input.toRole,
    senderName: cleanText(input.senderName, maxSenderNameLength),
    schoolName: cleanText(input.schoolName, maxSchoolNameLength),
    note: cleanText(input.note, maxNoteLength),
    verificationCode: createVerificationCode(),
    createdAt: new Date().toISOString(),
  };
}

export const encodeCollaborationInvite = (invite: CollaborationInvite) => base64UrlEncode(JSON.stringify(invite));

export function decodeCollaborationInvite(token: string): CollaborationInvite | null {
  try {
    return normalizeInvite(JSON.parse(base64UrlDecode(token)));
  } catch {
    return null;
  }
}

export function createCollaborationInviteUrl(invite: CollaborationInvite, currentUrl = window.location.href) {
  const url = new URL(currentUrl);
  url.pathname = invite.toRole === "teacher" ? "/" : "/director";
  url.search = "";
  url.hash = `${inviteHashKey}=${encodeCollaborationInvite(invite)}`;
  return url.toString();
}

export function inviteFromLocation(hash = window.location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get(inviteHashKey);
  return token ? decodeCollaborationInvite(token) : null;
}

export function clearInviteFromLocation() {
  const url = new URL(window.location.href);
  if (!url.hash.includes(inviteHashKey)) return;
  url.hash = "";
  window.history.replaceState({}, "", url.toString());
}

export function loadCollaborationContacts(storage: Storage = window.localStorage): CollaborationContact[] {
  try {
    const parsed = JSON.parse(storage.getItem(contactsStorageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const invite = normalizeInvite(item);
      const acceptedAt = item && typeof item === "object" ? (item as Partial<CollaborationContact>).acceptedAt : "";
      return invite && typeof acceptedAt === "string" ? [{ ...invite, acceptedAt }] : [];
    });
  } catch {
    return [];
  }
}

export function acceptCollaborationInvite(invite: CollaborationInvite, storage: Storage = window.localStorage) {
  const contacts = loadCollaborationContacts(storage);
  const next = [{ ...invite, acceptedAt: new Date().toISOString() }, ...contacts.filter((contact) => contact.id !== invite.id)].slice(0, 20);
  try { storage.setItem(contactsStorageKey, JSON.stringify(next)); } catch { /* Keep the invitation accepted for the current session. */ }
  return next;
}

export function removeCollaborationContact(id: string, storage: Storage = window.localStorage) {
  const next = loadCollaborationContacts(storage).filter((contact) => contact.id !== id);
  try { storage.setItem(contactsStorageKey, JSON.stringify(next)); } catch { /* Keep the removal for the current session. */ }
  return next;
}
