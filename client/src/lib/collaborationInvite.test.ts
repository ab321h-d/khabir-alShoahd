import { describe, expect, it } from "vitest";
import { acceptCollaborationInvite, createCollaborationInvite, createCollaborationInviteUrl, decodeCollaborationInvite, encodeCollaborationInvite, inviteFromLocation, loadCollaborationContacts, removeCollaborationContact } from "./collaborationInvite";

describe("collaboration invitations", () => {
  it("encodes and decodes a local invitation without changing its roles", () => {
    const invite = createCollaborationInvite({ fromRole: "director", toRole: "teacher", senderName: "أ. نورة", schoolName: "مدرسة الأمل", note: "انضم إلى فريق المدرسة" });
    expect(decodeCollaborationInvite(encodeCollaborationInvite(invite))).toMatchObject({ fromRole: "director", toRole: "teacher", senderName: "أ. نورة", schoolName: "مدرسة الأمل", verificationCode: invite.verificationCode });
    expect(invite.verificationCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
  });

  it("creates a compact link that routes a teacher invitation to the main application", () => {
    const invite = createCollaborationInvite({ fromRole: "director", toRole: "teacher", senderName: "", note: "" });
    const url = createCollaborationInviteUrl(invite, "https://example.test/director?view=inbox");
    expect(new URL(url).pathname).toBe("/");
    expect(inviteFromLocation(new URL(url).hash)?.id).toBe(invite.id);
  });

  it("supports all teacher and director invitation directions", () => {
    const directions = [["teacher", "teacher"], ["teacher", "director"], ["director", "teacher"], ["director", "director"]] as const;
    directions.forEach(([fromRole, toRole]) => {
      const invite = createCollaborationInvite({ fromRole, toRole, senderName: "", note: "" });
      const url = new URL(createCollaborationInviteUrl(invite, "https://example.test/director"));
      expect(url.pathname).toBe(toRole === "teacher" ? "/" : "/director");
      expect(inviteFromLocation(url.hash)?.fromRole).toBe(fromRole);
    });
  });

  it("rejects malformed invitation text", () => {
    expect(decodeCollaborationInvite("not-an-invite")).toBeNull();
  });

  it("stores an accepted invitation once on the local device", () => {
    const storage = new Map<string, string>();
    const fakeStorage = { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) } as unknown as Storage;
    const invite = createCollaborationInvite({ fromRole: "teacher", toRole: "teacher", senderName: "أمل", note: "" });
    expect(acceptCollaborationInvite(invite, fakeStorage)).toHaveLength(1);
    expect(acceptCollaborationInvite(invite, fakeStorage)).toHaveLength(1);
    expect(removeCollaborationContact(invite.id, fakeStorage)).toHaveLength(0);
    expect(loadCollaborationContacts(fakeStorage)).toHaveLength(0);
  });

  it("keeps version-one invitations readable after adding school links", () => {
    const legacy = { version: 1, id: "legacy", fromRole: "director", toRole: "teacher", senderName: "مدير سابق", note: "", createdAt: "2026-08-21T00:00:00.000Z" };
    expect(decodeCollaborationInvite(encodeCollaborationInvite(legacy as never))).toMatchObject({ version: 1, schoolName: "", verificationCode: "" });
  });
});
