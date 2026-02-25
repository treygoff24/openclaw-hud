// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

document.body.innerHTML = `
  <div id="spawn-modal" class="modal-overlay">
    <input id="spawn-label" />
    <select id="spawn-mode"><option value="run">run</option><option value="session">session</option></select>
    <input id="spawn-timeout" />
    <textarea id="spawn-files"></textarea>
    <textarea id="spawn-prompt"></textarea>
    <select id="spawn-agent"></select>
    <select id="spawn-model"></select>
    <div id="spawn-error" style="display:none"></div>
    <button id="new-session-btn"></button>
    <button id="open-spawn-btn"></button>
    <button id="spawn-cancel-btn"></button>
    <button id="spawn-modal-close"></button>
    <button id="spawn-launch-btn"></button>
  </div>
  <div id="toast" class="toast"></div>
`;
window.HUD = window.HUD || {};
window.HUD.showToast = vi.fn();
window.HUD.fetchAll = vi.fn();
window._agents = [{ id: "bot1" }, { id: "bot2" }];
window._modelAliases = [{ alias: "gpt4", fullId: "openai/gpt-4" }];
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

window.WebSocket = { OPEN: 1 };
window._hudWs = null;
window.ChatState = {
  currentSession: null,
  subscribedKey: null,
  activeRuns: new Map(),
  pendingAcks: new Map(),
  sendWs: vi.fn(),
};
window.openChatPane = vi.fn();

await import("../../../public/panels/spawn.js");
HUD.spawn.init();

describe("spawn.newSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.ChatState.sendWs = vi.fn();
    window.openChatPane = vi.fn();
    window.ChatState.currentSession = null;
    window._agents = [{ id: "bot1" }, { id: "bot2" }];
  });

  afterEach(() => {
    window._agents = [{ id: "bot1" }, { id: "bot2" }];
  });

  it("sends chat-new with agentId from current subscribed session", () => {
    window.ChatState.currentSession = {
      agentId: "bot2",
      sessionId: "main",
      sessionKey: "agent:bot2:main",
    };
    HUD.spawn.newSession();
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "chat-new",
      agentId: "bot2",
      source: "tree",
    });
  });

  it("falls back to first agent when no session is open", () => {
    window.ChatState.currentSession = null;
    HUD.spawn.newSession();
    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "chat-new",
      agentId: "bot1",
      source: "tree",
    });
  });

  it("does nothing when no agent is available", () => {
    window.ChatState.currentSession = null;
    window._agents = [];
    HUD.spawn.newSession();
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
  });

  it("#new-session-btn click sends chat-new via sendWs", () => {
    window._agents = [{ id: "bot1" }];
    window.ChatState.currentSession = null;
    document.getElementById("new-session-btn").click();
    expect(window.ChatState.sendWs).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chat-new", agentId: "bot1", source: "tree" }),
    );
  });
});

describe("spawn.init", () => {
  it("does not throw when #new-session-btn is missing", () => {
    const spawnModal = document.getElementById("spawn-modal");
    const newSessionBtn = document.getElementById("new-session-btn");
    newSessionBtn?.remove();
    expect(() => HUD.spawn.init()).not.toThrow();
    if (spawnModal && newSessionBtn) {
      spawnModal.appendChild(newSessionBtn);
    }
  });
});

describe("spawn.open", () => {
  it("opens the spawn modal", () => {
    HUD.spawn.open();
    expect(document.getElementById("spawn-modal").classList.contains("active")).toBe(true);
  });

  it("populates agent select with available agents", () => {
    HUD.spawn.open();
    const options = document.getElementById("spawn-agent").querySelectorAll("option");
    expect(options.length).toBe(2);
    expect(options[0].value).toBe("bot1");
  });

  it("populates model select", () => {
    HUD.spawn.open();
    const options = document.getElementById("spawn-model").querySelectorAll("option");
    expect(options.length).toBe(1);
    expect(options[0].value).toBe("openai/gpt-4");
  });

  it("resets form fields", () => {
    document.getElementById("spawn-label").value = "old";
    HUD.spawn.open();
    expect(document.getElementById("spawn-label").value).toBe("");
    expect(document.getElementById("spawn-timeout").value).toBe("300");
  });
});

describe("spawn.model change auto-populates label", () => {
  it("auto-populates label field with selected model alias when label is empty", () => {
    window._modelAliases = [
      { alias: "Claude Opus", fullId: "anthropic/claude-3-opus" },
      { alias: "GPT-4", fullId: "openai/gpt-4" },
    ];
    HUD.spawn.init();
    HUD.spawn.open();
    const labelField = document.getElementById("spawn-label");
    const modelSelect = document.getElementById("spawn-model");

    // Label should be empty initially
    labelField.value = "";

    // Change model selection
    modelSelect.value = "anthropic/claude-3-opus";
    modelSelect.dispatchEvent(new Event("change"));

    // The option text includes the alias and the model ID in parentheses
    expect(labelField.value).toBe("Claude Opus (claude-3-opus)");
  });

  it("does not overwrite existing label when model changes", () => {
    window._modelAliases = [
      { alias: "Claude Opus", fullId: "anthropic/claude-3-opus" },
      { alias: "GPT-4", fullId: "openai/gpt-4" },
    ];
    HUD.spawn.open();
    const labelField = document.getElementById("spawn-label");
    const modelSelect = document.getElementById("spawn-model");

    // Set an existing label
    labelField.value = "My Custom Task";

    // Change model selection
    modelSelect.value = "anthropic/claude-3-opus";
    modelSelect.dispatchEvent(new Event("change"));

    // Label should remain unchanged
    expect(labelField.value).toBe("My Custom Task");
  });

  it("does not auto-populate label if selected option has no text", () => {
    HUD.spawn.open();
    const labelField = document.getElementById("spawn-label");
    const modelSelect = document.getElementById("spawn-model");

    labelField.value = "";

    // Simulate a case where no option is selected (empty value)
    modelSelect.value = "";
    modelSelect.dispatchEvent(new Event("change"));

    expect(labelField.value).toBe("");
  });
});

describe("spawn.close", () => {
  it("closes the modal", () => {
    HUD.spawn.open();
    HUD.spawn.close();
    expect(document.getElementById("spawn-modal").classList.contains("active")).toBe(false);
  });
});

describe("spawn.launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      }),
    );
  });

  it("shows error when prompt is empty", async () => {
    HUD.spawn.open();
    document.getElementById("spawn-prompt").value = "";
    await HUD.spawn.launch();
    expect(document.getElementById("spawn-error").textContent).toContain("required");
    expect(document.getElementById("spawn-error").style.display).toBe("block");
  });

  it("calls fetch with correct data when valid", async () => {
    HUD.spawn.open();
    document.getElementById("spawn-prompt").value = "Do something";
    await HUD.spawn.launch();
    expect(window.fetch).toHaveBeenCalledWith(
      "/api/spawn",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("handles fetch error gracefully", async () => {
    window.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: "spawn failed" }),
      }),
    );
    HUD.spawn.open();
    document.getElementById("spawn-prompt").value = "Do something";
    await HUD.spawn.launch();
    expect(document.getElementById("spawn-error").textContent).toContain("spawn failed");
  });
});
