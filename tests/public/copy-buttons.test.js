// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
});

window.escapeHtml = function (s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
window.marked = { parse: vi.fn((t) => "<p>" + t + "</p>"), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn((t) => t), addHook: vi.fn() };

await import("../../public/label-sanitizer.js");
await import("../../public/chat-sender-resolver.js");
await import("../../public/chat-markdown.js");
await import("../../public/copy-utils.js");
await import("../../public/chat-tool-blocks.js");
await import("../../public/chat-message.js");

describe("Copy Buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigator.clipboard.writeText.mockClear();
  });

  describe("Tool Use Block Copy Button", () => {
    it("creates tool use block with copy button", () => {
      const block = { id: "t1", name: "exec", input: { command: "ls -la" } };
      const el = window.ChatToolBlocks.createToolUseBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      expect(copyBtn).not.toBeNull();
    });

    it("copy button has copy icon", () => {
      const block = { id: "t1", name: "exec", input: { command: "ls" } };
      const el = window.ChatToolBlocks.createToolUseBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      expect(copyBtn.innerHTML).toContain("<svg");
    });

    it("copies tool name and arguments as JSON on click", async () => {
      const block = { id: "t1", name: "exec", input: { command: "ls -la", path: "/home" } };
      const el = window.ChatToolBlocks.createToolUseBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      const copiedText = navigator.clipboard.writeText.mock.calls[0][0];
      const parsed = JSON.parse(copiedText);
      expect(parsed.name).toBe("exec");
      expect(parsed.input.command).toBe("ls -la");
    });

    it("shows copied state after click", async () => {
      const block = { id: "t1", name: "exec", input: {} };
      const el = window.ChatToolBlocks.createToolUseBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(copyBtn.classList.contains("copied")).toBe(true);
    });
  });

  describe("Tool Result Block Copy Button", () => {
    it("creates tool result block with copy button", () => {
      const block = { tool_use_id: "t1", content: "output here" };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      expect(copyBtn).not.toBeNull();
    });

    it("copies full result content on click", async () => {
      const content = "some long output";
      const block = { tool_use_id: "t1", content: content };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(content);
    });

    it("copies full content when truncated", async () => {
      const fullContent = "x".repeat(2000);
      const block = { tool_use_id: "t1", content: fullContent };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(fullContent);
    });

    it("formats tool result as code block", () => {
      const block = { tool_use_id: "t1", content: "output" };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const contentEl = el.querySelector(".chat-tool-result-content");
      expect(contentEl.classList.contains("code-block")).toBe(true);
    });
  });

  describe("Assistant Message Copy Button", () => {
    it("creates assistant message with copy button", () => {
      const msg = { role: "assistant", content: [{ type: "text", text: "Hello world" }] };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      expect(copyBtn).not.toBeNull();
    });

    it("copies text content on click", async () => {
      const msg = {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
        timestamp: new Date().toISOString(),
      };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hello world");
    });

    it("copies all text content from multiple blocks", async () => {
      const msg = {
        role: "assistant",
        content: [
          { type: "text", text: "First part " },
          { type: "text", text: "Second part" },
        ],
        timestamp: new Date().toISOString(),
      };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      // Content blocks are joined with newline (first part has trailing space)
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("First part \nSecond part");
    });

    it("shows copied state after click", async () => {
      const msg = {
        role: "assistant",
        content: [{ type: "text", text: "Test" }],
        timestamp: new Date().toISOString(),
      };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(copyBtn.classList.contains("copied")).toBe(true);
    });
  });

  describe("User Message Copy Button", () => {
    it("creates user message with copy button", () => {
      const msg = { role: "user", content: [{ type: "text", text: "User message" }] };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      expect(copyBtn).not.toBeNull();
    });

    it("copies user message content", async () => {
      const msg = {
        role: "user",
        content: [{ type: "text", text: "User message" }],
        timestamp: new Date().toISOString(),
      };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("User message");
    });
  });

  describe("Copy button visibility", () => {
    it("copy button is visible on hover", () => {
      const block = { id: "t1", name: "exec", input: {} };
      const el = window.ChatToolBlocks.createToolUseBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      // Button should exist but may have opacity 0 when not hovered
      expect(copyBtn).not.toBeNull();
    });

    it("copy button exists for tool result block", () => {
      const block = { tool_use_id: "t1", content: "test" };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      expect(copyBtn).not.toBeNull();
    });
  });

  describe("Edge cases", () => {
    it("handles empty tool use block", async () => {
      const block = { id: "t1", name: "exec", input: {} };
      const el = window.ChatToolBlocks.createToolUseBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      const copiedText = navigator.clipboard.writeText.mock.calls[0][0];
      const parsed = JSON.parse(copiedText);
      expect(parsed.name).toBe("exec");
    });

    it("handles empty tool result block", async () => {
      const block = { tool_use_id: "t1", content: "" };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("");
    });

    it("handles null content in tool result", async () => {
      const block = { tool_use_id: "t1", content: null };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });

    it("handles empty message content", async () => {
      const msg = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        timestamp: new Date().toISOString(),
      };
      const el = window.ChatMessage.renderHistoryMessage(msg);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("");
    });

    it("handles object content in tool result", async () => {
      const block = { tool_use_id: "t1", content: { result: "value", nested: { key: "val" } } };
      const el = window.ChatToolBlocks.createToolResultBlock(block);

      const copyBtn = el.querySelector(".copy-btn");
      await copyBtn.click();

      const expected = JSON.stringify({ result: "value", nested: { key: "val" } }, null, 2);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expected);
    });
  });
});
