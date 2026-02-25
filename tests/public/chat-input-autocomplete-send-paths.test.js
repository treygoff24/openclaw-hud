// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

function setupDOM() {
  document.body.innerHTML = `
    <div id="chat-messages"></div>
    <div class="chat-header"></div>
    <div id="chat-input-area" style="position:relative;height:100px;">
      <textarea id="chat-input" class="chat-input" rows="1"></textarea>
      <button id="chat-send-btn">Send</button>
      <button id="chat-stop-btn">Stop</button>
      <button id="chat-new-btn">New</button>
    </div>
  `;
}

Element.prototype.getBoundingClientRect = function () {
  return { top: 100, left: 10, right: 500, bottom: 140, width: 490, height: 40, x: 10, y: 100 };
};
Element.prototype.scrollIntoView = vi.fn();

window.HUD = { showToast: vi.fn() };
window.ChatState = {
  currentSession: { sessionKey: "agent:test:main", agentId: "test-agent" },
  sendWs: vi.fn(),
  pendingAcks: new Map(),
  cachedModels: null,
};

if (!globalThis.crypto) globalThis.crypto = {};
if (!globalThis.crypto.randomUUID) {
  let uuidCounter = 0;
  globalThis.crypto.randomUUID = () => `uuid-${++uuidCounter}`;
}

setupDOM();
await import("../../public/chat-input/attachments.js");
await import("../../public/chat-input/autocomplete.js");
await import("../../public/chat-input/send-flow.js");
await import("../../public/chat-input/model-picker.js");
await import("../../public/chat-commands/catalog.js");
await import("../../public/chat-commands/fuzzy.js");
await import("../../public/chat-commands/registry.js");
await import("../../public/chat-commands/help.js");
await import("../../public/chat-commands/local-exec.js");
await import("../../public/chat-commands.js");
await import("../../public/chat-input.js");

describe("chat-input autocomplete and slash send paths", () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
    window.ChatState.pendingAcks = new Map();
    window.ChatState.currentSession = { sessionKey: "agent:test:main", agentId: "test-agent" };
    window.ChatInput._clearAttachments();
    window.ChatInput._initAttachments();
  });

  it("navigates autocomplete with arrows and completes selected command on Enter", () => {
    const input = document.getElementById("chat-input");
    input.value = "/mo";
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    expect(dropdown).not.toBeNull();
    expect(dropdown.style.display).toBe("block");

    const initialSelected = dropdown.querySelector(".slash-item.selected .slash-name").textContent;
    expect(initialSelected).toBe("/model");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );

    const nextSelected = dropdown.querySelector(".slash-item.selected .slash-name").textContent;
    expect(nextSelected).toBe("/models");

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(input.value).toBe("/models ");
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
  });

  it("handles local slash commands without sending to server", () => {
    const executeSpy = vi.spyOn(window.ChatCommands, "execute").mockReturnValue({
      handled: true,
      local: true,
      result: "Local command output",
    });

    const input = document.getElementById("chat-input");
    input.value = "/help";

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(executeSpy).toHaveBeenCalledWith("/help");
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
    expect(document.querySelector(".command-output").textContent).toBe("Local command output");
    expect(input.value).toBe("");
  });

  it("sends non-local slash commands to server as chat-send", () => {
    const executeSpy = vi.spyOn(window.ChatCommands, "execute").mockReturnValue({
      handled: false,
      local: false,
    });

    const input = document.getElementById("chat-input");
    input.value = "/search deterministic tests";

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(executeSpy).toHaveBeenCalledWith("/search deterministic tests");
    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(1);
    expect(window.ChatState.sendWs).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat-send",
        message: "/search deterministic tests",
        sessionKey: "agent:test:main",
      }),
    );
  });

  it("renders model picker and sends chat-new when a model is selected", () => {
    window.ChatInput.renderModelPicker(["openai/gpt-4.1", "anthropic/claude-3.7-sonnet"]);

    const picker = document.querySelector(".model-picker");
    expect(picker).not.toBeNull();
    expect(picker.querySelectorAll(".model-picker-item")).toHaveLength(2);

    picker.querySelectorAll(".model-picker-item")[1].click();

    expect(window.ChatState.sendWs).toHaveBeenCalledWith({
      type: "chat-new",
      model: "anthropic/claude-3.7-sonnet",
    });
    expect(document.querySelector(".model-picker")).toBeNull();
  });

  it("does not render model picker for empty model list", () => {
    window.ChatInput.renderModelPicker([]);
    expect(document.querySelector(".model-picker")).toBeNull();
  });
});
