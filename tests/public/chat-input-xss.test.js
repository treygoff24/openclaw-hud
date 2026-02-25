// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Set up minimal DOM for XSS tests
document.body.innerHTML = `
  <div id="chat-input-area" style="position:relative;height:100px;">
    <textarea id="chat-input" class="chat-input" placeholder="Type a message..." rows="1"></textarea>
  </div>
  <div id="chat-messages"></div>
`;

// Mock getBoundingClientRect for all elements
const mockRect = {
  top: 100,
  left: 10,
  right: 500,
  bottom: 140,
  width: 490,
  height: 40,
  x: 10,
  y: 100,
};
Element.prototype.getBoundingClientRect = function () {
  return mockRect;
};

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock ChatState
window.ChatState = {
  currentSession: { sessionKey: "agent:test:session1" },
  pendingAcks: new Map(),
  cachedModels: ["openai/gpt-4", "anthropic/claude-3"],
  sendWs: vi.fn(),
};

// Mock ChatCommands with a command that returns XSS payloads
window.ChatCommands = {
  find: vi.fn(),
  search: vi.fn(() => []),
  execute: vi.fn(),
  getAll: vi.fn(() => []),
};

// Mock HUD
window.HUD = {
  showToast: vi.fn(),
};

// Load the input module
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

describe("chat-input.js XSS prevention", () => {
  let container;

  beforeEach(() => {
    container = document.getElementById("chat-messages");
    container.innerHTML = "";
    vi.clearAllMocks();
  });

  describe("showCommandResult", () => {
    it("escapes <script> tags and does not execute them", () => {
      const maliciousResult = '<script>alert("XSS")</script>';

      window.ChatInput._showCommandResult(maliciousResult);

      // Get the last message added
      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      // The text content should contain the literal script tag
      expect(pre.textContent).toBe('<script>alert("XSS")</script>');

      // Verify no script was executed (innerHTML should not contain executable script)
      expect(pre.innerHTML).not.toContain("<script>alert");
      expect(pre.innerHTML).not.toMatch(/<script[^>]*>/i);
    });

    it("escapes HTML event handlers in output", () => {
      const maliciousResult = '<img src=x onerror="alert(1)">';

      window.ChatInput._showCommandResult(maliciousResult);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      // Should be escaped as text, not rendered as HTML
      expect(pre.textContent).toBe('<img src=x onerror="alert(1)">');
      expect(pre.querySelector("img")).toBeNull();
    });

    it("escapes javascript: URLs", () => {
      const maliciousResult = '<a href="javascript:alert(1)">click</a>';

      window.ChatInput._showCommandResult(maliciousResult);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      expect(pre.textContent).toBe('<a href="javascript:alert(1)">click</a>');
      expect(pre.querySelector("a")).toBeNull();
    });

    it("escapes SVG-based XSS payloads", () => {
      const maliciousResult = '<svg onload="alert(1)"><circle r="10"/></svg>';

      window.ChatInput._showCommandResult(maliciousResult);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      expect(pre.textContent).toBe('<svg onload="alert(1)"><circle r="10"/></svg>');
      expect(pre.querySelector("svg")).toBeNull();
    });

    it("escapes multiple script tags", () => {
      const maliciousResult = "<script>a</script><script>b</script>";

      window.ChatInput._showCommandResult(maliciousResult);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      expect(pre.textContent).toBe("<script>a</script><script>b</script>");
    });

    it("escapes script tags with attributes", () => {
      const maliciousResult = '<script type="text/javascript" src="evil.js"></script>';

      window.ChatInput._showCommandResult(maliciousResult);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      expect(pre.textContent).toBe('<script type="text/javascript" src="evil.js"></script>');
    });

    it("preserves newlines in output", () => {
      const result = "line1\nline2\nline3";

      window.ChatInput._showCommandResult(result);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      // textContent preserves newlines in a pre element
      expect(pre.textContent).toBe("line1\nline2\nline3");
    });

    it("handles ampersands correctly", () => {
      const result = "Tom & Jerry <cartoon>";

      window.ChatInput._showCommandResult(result);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      expect(pre.textContent).toBe("Tom & Jerry <cartoon>");
    });

    it("escapes mixed HTML and text content", () => {
      const result = "Hello <b>world</b>!\n<script>alert(1)</script>";

      window.ChatInput._showCommandResult(result);

      const messages = container.querySelectorAll(".chat-msg");
      const lastMessage = messages[messages.length - 1];
      const pre = lastMessage.querySelector("pre.command-output");

      expect(pre.textContent).toBe("Hello <b>world</b>!\n<script>alert(1)</script>");
      expect(pre.querySelector("b")).toBeNull();
      expect(pre.querySelector("script")).toBeNull();
    });

    it("handles empty result gracefully", () => {
      window.ChatInput._showCommandResult("");

      // Empty result should not create a message
      const messages = container.querySelectorAll(".chat-msg");
      expect(messages.length).toBe(0);
    });

    it("handles null result gracefully", () => {
      window.ChatInput._showCommandResult(null);

      const messages = container.querySelectorAll(".chat-msg");
      expect(messages.length).toBe(0);
    });

    it("creates proper message structure", () => {
      const result = "Test output";

      window.ChatInput._showCommandResult(result);

      const messages = container.querySelectorAll(".chat-msg");
      expect(messages.length).toBe(1);

      const msg = messages[0];
      expect(msg.classList.contains("system")).toBe(true);

      const roleSpan = msg.querySelector(".chat-msg-role.system");
      expect(roleSpan).not.toBeNull();
      expect(roleSpan.textContent).toBe("system");

      const contentDiv = msg.querySelector(".chat-msg-content");
      expect(contentDiv).not.toBeNull();

      const pre = contentDiv.querySelector("pre.command-output");
      expect(pre).not.toBeNull();
    });
  });
});
