// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

window.ChatCommandsModules = window.ChatCommandsModules || {};
window.ChatCommandsModules.help = {
  renderHelp: () => "help payload",
};
window.ChatState = {
  sendWs: vi.fn(),
  currentSession: { sessionKey: "agent:test:session1" },
};

await import("../../public/chat-commands/local-exec.js");

describe("ChatCommandsModules.localExec", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chat-messages"><div id="chat-empty">No messages</div></div>
      <span id="stat-uptime">01:02:03</span>
      <span id="stat-agents">4</span>
      <span id="stat-active">2</span>
      <span id="sys-model">claude-3.7</span>
    `;
    vi.clearAllMocks();
    window.ChatState.currentSession = { sessionKey: "agent:test:session1" };
  });
  it("handles help and returns help payload", () => {
    const response = window.ChatCommandsModules.localExec.executeLocal({ name: "help" }, "");

    expect(response).toEqual({
      handled: true,
      local: true,
      result: "help payload",
    });
  });

  it("sends chat-abort and chat-new when session exists", () => {
    window.ChatState.currentSession = { sessionKey: "agent:test:session1" };

    const abortResult = window.ChatCommandsModules.localExec.executeLocal({ name: "abort" }, "");
    const resetResult = window.ChatCommandsModules.localExec.executeLocal({ name: "reset" }, "");

    expect(abortResult.handled).toBe(true);
    expect(resetResult.result).toContain("Resetting current session...");
    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(2);
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "chat-abort",
      sessionKey: "agent:test:session1",
    });
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({ type: "chat-new", model: null });
  });

  it("returns a local no-session result for /reset when session is missing", () => {
    window.ChatState.currentSession = null;
    const result = window.ChatCommandsModules.localExec.executeLocal({ name: "reset" }, "");

    expect(result.handled).toBe(true);
    expect(result.result).toContain("No active session");
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
  });

  it("starts new session with and without explicit model", () => {
    const explicit = window.ChatCommandsModules.localExec.executeLocal({ name: "new" }, "llm-x");
    const implicit = window.ChatCommandsModules.localExec.executeLocal({ name: "new" }, "   ");

    expect(explicit.result).toBe("Starting new session with llm-x...");
    expect(implicit.result).toBe("Starting new session...");
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "chat-new",
      model: "llm-x",
    });
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "chat-new",
      model: null,
    });
  });

  it("updates UI state for clear and computes status/model/think/verbose/models commands", () => {
    const container = document.getElementById("chat-messages");
    const clear = window.ChatCommandsModules.localExec.executeLocal({ name: "clear" }, "");

    expect(clear.result).toBe("Chat cleared");
    expect(container.childNodes.length).toBe(1);

    const modelStatus = window.ChatCommandsModules.localExec.executeLocal({ name: "model" }, "");
    expect(modelStatus.result).toContain("Current model: claude-3.7");

    const modelSet = window.ChatCommandsModules.localExec.executeLocal(
      { name: "model" },
      "mistral-7b",
    );
    expect(modelSet.result).toBe("Setting model to mistral-7b...");
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "sessions.patch",
      sessionKey: "agent:test:session1",
      model: "mistral-7b",
    });

    const think = window.ChatCommandsModules.localExec.executeLocal({ name: "think" }, "off");
    expect(think.result).toBe("Setting thinking to off...");
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "sessions.patch",
      sessionKey: "agent:test:session1",
      thinking: "off",
    });

    const verbose = window.ChatCommandsModules.localExec.executeLocal({ name: "verbose" }, "");
    expect(verbose.result).toBe("Setting verbose to on...");
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "sessions.patch",
      sessionKey: "agent:test:session1",
      verbose: true,
    });

    const models = window.ChatCommandsModules.localExec.executeLocal(
      { name: "models" },
      "provider-x",
    );
    expect(models.result).toBe("Fetching available models...");
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "models-list",
      provider: "provider-x",
    });

    const status = window.ChatCommandsModules.localExec.executeLocal({ name: "status" }, "");
    expect(status.result).toContain("Uptime: 01:02:03");
    expect(status.result).toContain("Agents: 4");
    expect(status.result).toContain("Active: 2");
    expect(status.result).toContain("Session: agent:test:session1");
  });

  it("rejects invalid think/verbose values without sending WS", () => {
    const badThink = window.ChatCommandsModules.localExec.executeLocal({ name: "think" }, "high");
    const badVerbose = window.ChatCommandsModules.localExec.executeLocal(
      { name: "verbose" },
      "maybe",
    );

    expect(badThink.result).toContain("Invalid thinking mode");
    expect(badVerbose.result).toContain("Invalid verbose mode");
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
  });

  it("returns no-session result for session-setting commands without sending WS", () => {
    window.ChatState.currentSession = null;

    const modelSet = window.ChatCommandsModules.localExec.executeLocal({ name: "model" }, "gpt-5");
    const think = window.ChatCommandsModules.localExec.executeLocal({ name: "think" }, "on");
    const verbose = window.ChatCommandsModules.localExec.executeLocal({ name: "verbose" }, "off");

    expect(modelSet.result).toContain("No active session");
    expect(think.result).toContain("No active session");
    expect(verbose.result).toContain("No active session");
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
  });

  it("returns unhandled for unknown command", () => {
    const result = window.ChatCommandsModules.localExec.executeLocal({ name: "unknown" }, "abc");
    expect(result).toEqual({
      handled: false,
      local: false,
      command: { name: "unknown" },
      args: "abc",
    });
  });
});
