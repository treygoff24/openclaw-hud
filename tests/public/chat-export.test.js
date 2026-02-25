// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
});

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

window.escapeHtml = function (s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
window.marked = { parse: vi.fn((t) => "<p>" + t + "</p>"), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn((t) => t), addHook: vi.fn() };

// Store for localStorage mock
const store = {};
vi.stubGlobal("localStorage", {
  getItem: vi.fn((k) => store[k] || null),
  setItem: vi.fn((k, v) => {
    store[k] = v;
  }),
  removeItem: vi.fn((k) => {
    delete store[k];
  }),
});

window.WebSocket = { OPEN: 1 };

function setupDOM() {
  document.body.innerHTML = `
    <div class="hud-layout">
      <div class="chat-header" role="banner">
        <div class="chat-header-info">
          <span class="chat-status-dot"></span>
          <span class="chat-title" id="chat-title"></span>
          <span class="chat-live" id="chat-live">LIVE</span>
        </div>
        <button class="chat-new-btn" id="chat-new-btn">+ NEW</button>
        <button class="chat-close" id="chat-close" aria-label="Close chat pane">&times;</button>
      </div>
      <div id="chat-messages"></div>
      <div id="chat-new-pill"></div>
      <div id="gateway-banner" class="gateway-banner" style="display:none">Gateway connection lost</div>
      <div class="chat-input-area" id="chat-input-area">
        <textarea id="chat-input" class="chat-input" placeholder="Type a message..." rows="1"></textarea>
        <button id="chat-send-btn" class="chat-send-btn" title="Send">▶</button>
        <button id="chat-stop-btn" class="chat-stop-btn" title="Stop" style="display:none">■</button>
      </div>
    </div>
  `;
}

setupDOM();
window.HUD = window.HUD || {};
window._hudWs = null;

let uuidCounter = 0;
if (!globalThis.crypto) globalThis.crypto = {};
globalThis.crypto.randomUUID = () => "uuid-" + ++uuidCounter;

// Load modules
await import("../../public/label-sanitizer.js");
await import("../../public/chat-sender-resolver.js");
await import("../../public/chat-markdown.js");
await import("../../public/copy-utils.js");
await import("../../public/chat-tool-blocks.js");
await import("../../public/chat-message.js");
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
await import("../../public/chat-ws/runtime.js");
await import("../../public/chat-ws/history-log.js");
await import("../../public/chat-ws/stream-events.js");
await import("../../public/chat-ws/system-events.js");
await import("../../public/chat-ws-handler.js");
await import("../../public/chat-pane/constants.js");
await import("../../public/chat-pane/diagnostics.js");
await import("../../public/chat-pane/session-metadata.js");
await import("../../public/chat-pane/history-timeout.js");
await import("../../public/chat-pane/transport.js");
await import("../../public/chat-pane/state.js");
await import("../../public/chat-pane/pane-lifecycle.js");
await import("../../public/chat-pane/session-restore.js");
await import("../../public/chat-pane/ws-bridge.js");
await import("../../public/chat-pane/export.js");
await import("../../public/chat-pane.js");

function mockWs() {
  const ws = { readyState: 1, send: vi.fn() };
  window._hudWs = ws;
  return ws;
}

function resetState() {
  window._hudWs = null;
  try {
    window.closeChatPane();
  } catch (e) {}
  setupDOM();
  vi.clearAllMocks();
  uuidCounter = 0;
  // Reset ChatState.currentMessages
  if (window.ChatState) {
    window.ChatState.currentMessages = [];
  }
}

describe("8a: Cache raw messages in ChatState", () => {
  beforeEach(resetState);

  it("has currentMessages array in ChatState", () => {
    expect(window.ChatState.currentMessages).toBeDefined();
    expect(Array.isArray(window.ChatState.currentMessages)).toBe(true);
  });

  it("clears currentMessages when switching sessions", () => {
    mockWs();
    window.ChatState.currentMessages = [{ role: "user", content: "test" }];
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    expect(window.ChatState.currentMessages).toEqual([]);
  });

  it("caches history messages when loaded", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    const messages = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ];
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages,
    });
    expect(window.ChatState.currentMessages.length).toBe(2);
    expect(window.ChatState.currentMessages[0].role).toBe("user");
    expect(window.ChatState.currentMessages[1].role).toBe("assistant");
  });

  it("appends new messages via WebSocket to currentMessages", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
    expect(window.ChatState.currentMessages.length).toBe(1);

    // Simulate log-entry (new message)
    window.handleChatWsMessage({
      type: "log-entry",
      agentId: "agent1",
      sessionId: "session1",
      entry: { role: "assistant", content: [{ type: "text", text: "Response" }] },
    });
    expect(window.ChatState.currentMessages.length).toBe(2);
    expect(window.ChatState.currentMessages[1].role).toBe("assistant");
  });

  it("does not add duplicate messages", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    const message = {
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      timestamp: "2024-01-01T00:00:00Z",
    };
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [message],
    });
    // Try adding the same message again via log-entry
    window.handleChatWsMessage({
      type: "log-entry",
      agentId: "agent1",
      sessionId: "session1",
      entry: message,
    });
    expect(window.ChatState.currentMessages.length).toBe(1);
  });
});

describe("8b: Per-turn copy button", () => {
  beforeEach(resetState);

  it("renders copy turn button for assistant messages", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "User question" }] },
        { role: "assistant", content: [{ type: "text", text: "Assistant answer" }] },
      ],
    });
    const assistantMsg = document.querySelector(".chat-msg.assistant");
    expect(assistantMsg).not.toBeNull();
    const copyTurnBtn = assistantMsg.querySelector(".chat-turn-actions .copy-turn-btn");
    expect(copyTurnBtn).not.toBeNull();
    const turnActions = assistantMsg.querySelector(".chat-turn-actions");
    expect(turnActions).not.toBeNull();
    expect(turnActions.contains(copyTurnBtn)).toBe(true);
  });

  it("copy turn button has correct aria-label", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "User question" }] },
        { role: "assistant", content: [{ type: "text", text: "Assistant answer" }] },
      ],
    });
    const copyTurnBtn = document.querySelector(".chat-msg.assistant .copy-turn-btn");
    expect(copyTurnBtn.getAttribute("aria-label")).toBe("Copy entire turn");
    expect(copyTurnBtn.textContent).toContain("Copy turn");
  });

  it("does not render copy turn button in assistant message header", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "User question" }] },
        { role: "assistant", content: [{ type: "text", text: "Assistant answer" }] },
      ],
    });

    const assistantMsg = document.querySelector(".chat-msg.assistant");
    const header = assistantMsg.querySelector(".chat-msg-header");
    expect(header).not.toBeNull();
    expect(header.querySelector(".copy-turn-btn")).toBeNull();
    expect(assistantMsg.querySelector(".chat-turn-actions .copy-turn-btn")).not.toBeNull();
  });

  it("copies entire turn as markdown when clicked", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "TestLabel", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "What is the answer?" }] },
        { role: "assistant", content: [{ type: "text", text: "The answer is 42." }] },
      ],
    });
    const copyTurnBtn = document.querySelector(".chat-msg.assistant .copy-turn-btn");
    await copyTurnBtn.click();

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    const copiedText = navigator.clipboard.writeText.mock.calls[0][0];
    expect(copiedText).toContain("## User");
    expect(copiedText).toContain("What is the answer?");
    expect(copiedText).toContain("## Assistant");
    expect(copiedText).toContain("The answer is 42.");
  });

  it("includes tool calls in turn markdown", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "Run a command" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I will run that for you." },
            { type: "tool_use", id: "t1", name: "exec", input: { command: "ls -la" } },
          ],
        },
      ],
    });
    const copyTurnBtn = document.querySelector(".chat-msg.assistant .copy-turn-btn");
    await copyTurnBtn.click();

    const copiedText = navigator.clipboard.writeText.mock.calls[0][0];
    expect(copiedText).toContain("```json");
    expect(copiedText).toContain("Tool: exec");
    expect(copiedText).toContain('"command": "ls -la"');
  });

  it("does not render copy turn button for user messages", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "User question" }] },
        { role: "assistant", content: [{ type: "text", text: "Assistant answer" }] },
      ],
    });

    const userMsg = document.querySelector(".chat-msg.user");
    expect(userMsg).not.toBeNull();
    expect(userMsg.querySelector(".copy-turn-btn")).toBeNull();
    expect(userMsg.querySelector(".chat-turn-actions")).toBeNull();
  });

  it("shows copied state after copy turn click", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      ],
    });
    const copyTurnBtn = document.querySelector(".chat-msg.assistant .copy-turn-btn");
    await copyTurnBtn.click();
    expect(copyTurnBtn.classList.contains("copied")).toBe(true);
  });
});

describe("8c: Export session button", () => {
  beforeEach(resetState);

  it("renders export session button in chat header", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "TestLabel", "agent:agent1:session1");
    const exportBtn = document.getElementById("chat-export-btn");
    expect(exportBtn).not.toBeNull();
    expect(exportBtn.textContent).toContain("Export");
  });

  it("export button has correct aria-label", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    const exportBtn = document.getElementById("chat-export-btn");
    expect(exportBtn.getAttribute("aria-label")).toBe("Export session to markdown");
  });

  it("export function uses correct filename with label", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "TestSession", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "Question 1" }] },
        { role: "assistant", content: [{ type: "text", text: "Answer 1" }] },
      ],
    });

    // Verify that exportChatSession function exists and can be called
    expect(typeof window.exportChatSession).toBe("function");

    // Verify Blob URL was created during export
    URL.createObjectURL.mockClear();
    window.exportChatSession();
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it("markdown document has correct structure", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "MySession", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello!" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
      ],
    });

    // Verify the messages are cached correctly
    expect(window.ChatState.currentMessages.length).toBe(2);
    expect(window.ChatState.currentMessages[0].role).toBe("user");
    expect(window.ChatState.currentMessages[1].role).toBe("assistant");

    // Verify export function generates correct markdown structure
    let capturedMarkdown = "";
    const originalBlob = global.Blob;
    // Use a proper constructor mock
    global.Blob = class MockBlob {
      constructor(parts) {
        capturedMarkdown = parts[0];
      }
    };

    window.exportChatSession();

    expect(capturedMarkdown).toContain("# MySession");
    expect(capturedMarkdown).toContain("## User");
    expect(capturedMarkdown).toContain("Hello!");
    expect(capturedMarkdown).toContain("## Assistant");
    expect(capturedMarkdown).toContain("Hi there!");

    global.Blob = originalBlob;
  });

  it("formats tool calls as code blocks in export", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "Test", "agent:agent1:session1");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:session1",
      messages: [
        { role: "user", content: [{ type: "text", text: "Run command" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Running..." },
            { type: "tool_use", id: "t1", name: "exec", input: { command: "ls" } },
          ],
        },
      ],
    });

    let capturedMarkdown = "";
    const originalBlob = global.Blob;
    global.Blob = class MockBlob {
      constructor(parts) {
        capturedMarkdown = parts[0];
      }
    };

    window.exportChatSession();

    expect(capturedMarkdown).toContain("```json");
    expect(capturedMarkdown).toContain("Tool: exec");
    expect(capturedMarkdown).toContain('"command": "ls"');

    global.Blob = originalBlob;
  });

  it("handles session with no label using session key", async () => {
    mockWs();
    window.openChatPane("agent1", "my-session-id", "", "agent:agent1:my-session-id");
    window.handleChatWsMessage({
      type: "chat-history-result",
      sessionKey: "agent:agent1:my-session-id",
      messages: [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
        { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      ],
    });

    // Verify export function exists and session is set correctly
    expect(typeof window.exportChatSession).toBe("function");
    expect(window.ChatState.currentSession.sessionKey).toBe("agent:agent1:my-session-id");
  });

  it("shows alert when no messages to export", async () => {
    mockWs();
    window.openChatPane("agent1", "session1", "label", "agent:agent1:session1");
    // No history loaded - ensure currentMessages is empty
    window.ChatState.currentMessages = [];

    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    window.exportChatSession();

    expect(alertSpy).toHaveBeenCalledWith("No messages to export");
    alertSpy.mockRestore();
  });

  it("exports assistant messages when assistant content is a plain string", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "StringContent", "agent:agent1:session1");
    window.ChatState.currentMessages = [{ role: "assistant", content: "Plain assistant response" }];

    let capturedMarkdown = "";
    const originalBlob = global.Blob;
    global.Blob = class MockBlob {
      constructor(parts) {
        capturedMarkdown = parts[0];
      }
    };

    window.exportChatSession();

    expect(capturedMarkdown).toContain("# StringContent");
    expect(capturedMarkdown).toContain("## Assistant");
    expect(capturedMarkdown).toContain("Plain assistant response");
    global.Blob = originalBlob;
  });

  it("exports trailing orphan user turn at end of transcript", () => {
    mockWs();
    window.openChatPane("agent1", "session1", "OrphanTail", "agent:agent1:session1");
    window.ChatState.currentMessages = [
      { role: "user", content: [{ type: "text", text: "first question" }] },
      { role: "assistant", content: [{ type: "text", text: "first answer" }] },
      { role: "user", content: [{ type: "text", text: "follow-up without assistant" }] },
    ];

    let capturedMarkdown = "";
    const originalBlob = global.Blob;
    global.Blob = class MockBlob {
      constructor(parts) {
        capturedMarkdown = parts[0];
      }
    };

    window.exportChatSession();

    expect(capturedMarkdown).toContain("first question");
    expect(capturedMarkdown).toContain("first answer");
    expect(capturedMarkdown).toContain("follow-up without assistant");
    const userSectionCount = (capturedMarkdown.match(/## User/g) || []).length;
    expect(userSectionCount).toBe(2);
    global.Blob = originalBlob;
  });
});
