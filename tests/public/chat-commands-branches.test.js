// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

if (!window.ChatState) {
  window.ChatState = {};
}

window.ChatState.sendWs = vi.fn();
window.ChatState.currentSession = { sessionKey: "agent:test:session1" };

await import("../../public/chat-commands/catalog.js");
await import("../../public/chat-commands/fuzzy.js");
await import("../../public/chat-commands/registry.js");
await import("../../public/chat-commands/help.js");
await import("../../public/chat-commands/local-exec.js");
await import("../../public/chat-commands.js");

describe("chat-commands branch coverage", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chat-messages">
        <div class="chat-msg">message 1</div>
        <div id="chat-empty">No messages yet</div>
      </div>
      <span id="sys-model">anthropic/claude-3.7-sonnet</span>
    `;
    vi.clearAllMocks();
    window.ChatState.currentSession = { sessionKey: "agent:test:session1" };
  });

  it("parse returns non-command shape for plain text", () => {
    const parsed = window.ChatCommands.parse("hello world");
    expect(parsed).toEqual({
      isCommand: false,
      command: null,
      args: "",
    });
  });

  it("execute returns unknown command error shape for missing command", () => {
    const result = window.ChatCommands.execute("/definitely-not-real");
    expect(result).toEqual({
      handled: false,
      local: false,
      result: null,
      error: "Unknown command",
    });
  });

  it("clear keeps #chat-empty when present", () => {
    const container = document.getElementById("chat-messages");
    expect(container.children.length).toBe(2);

    const result = window.ChatCommands.execute("/clear");

    expect(result).toEqual({
      handled: true,
      local: true,
      result: "Chat cleared",
    });
    expect(container.children.length).toBe(1);
    expect(container.firstElementChild?.id).toBe("chat-empty");
  });

  it("clear works when #chat-empty does not exist", () => {
    const empty = document.getElementById("chat-empty");
    empty.remove();

    const container = document.getElementById("chat-messages");
    expect(container.children.length).toBe(1);

    const result = window.ChatCommands.execute("/clear");

    expect(result).toEqual({
      handled: true,
      local: true,
      result: "Chat cleared",
    });
    expect(container.children.length).toBe(0);
  });

  it("model without arg returns current model fallback from DOM", () => {
    const result = window.ChatCommands.execute("/model");
    expect(result).toEqual({
      handled: true,
      local: true,
      result: "Current model: anthropic/claude-3.7-sonnet",
    });
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
  });
});
