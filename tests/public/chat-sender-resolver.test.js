// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

await import("../../public/chat-sender-resolver.js");

describe("ChatSenderResolver", () => {
  describe("resolveSessionRole", () => {
    it("prefers explicit backend sessionRole when spawn metadata is missing", () => {
      const role = window.ChatSenderResolver.resolveSessionRole({
        sessionRole: "main",
        sessionId: "internal-main-session",
        sessionKey: "agent:agent1:main",
      });

      expect(role).toBe("main");
    });

    it("infers main role for canonical main session keys without spawn metadata", () => {
      const role = window.ChatSenderResolver.resolveSessionRole({
        sessionKey: "agent:agent1:main",
      });

      expect(role).toBe("main");
    });

    it("keeps unknown role for empty session payloads", () => {
      expect(window.ChatSenderResolver.resolveSessionRole(null)).toBe("unknown");
      expect(window.ChatSenderResolver.resolveSessionRole({})).toBe("unknown");
    });
  });

  describe("resolveChatSenderDisplay", () => {
    it("uses Ren for backend-tagged main sessions even without spawnDepth", () => {
      const sender = window.ChatSenderResolver.resolveChatSenderDisplay({
        sessionRole: "main",
        sessionId: "internal-main-session",
        sessionKey: "agent:agent1:main",
        label: "Custom Label",
      });

      expect(sender.role).toBe("main");
      expect(sender.displayName).toBe("Ren");
      expect(sender.alias).toBe("Custom Label");
    });
  });
});
