// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock necessary globals before importing modules
window.escapeHtml = function (s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
window.marked = { parse: vi.fn((t) => "<p>" + t + "</p>"), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn((t) => t), addHook: vi.fn() };

// Mock ChatState
window.ChatState = {
  currentSession: { sessionKey: "agent:test:main", agentId: "test-agent", label: "Test Agent" },
  currentMessages: [],
};

// Mock ChatToolBlocks
window.ChatToolBlocks = {
  createToolUseBlock: vi.fn().mockImplementation((block) => {
    const el = document.createElement("div");
    el.className = "chat-tool-use";
    return el;
  }),
  createToolResultBlock: vi.fn().mockImplementation((block) => {
    const el = document.createElement("div");
    el.className = "chat-tool-result";
    return el;
  }),
  createThinkingBlock: vi.fn().mockImplementation((block) => {
    const el = document.createElement("div");
    el.className = "chat-thinking-block";
    return el;
  }),
  createToolGroup: vi.fn().mockImplementation((toolUseEls) => {
    const el = document.createElement("div");
    el.className = "chat-tool-group";
    return el;
  }),
};

await import("../../public/label-sanitizer.js");
await import("../../public/chat-sender-resolver.js");
await import("../../public/chat-markdown.js");
await import("../../public/copy-utils.js");
await import("../../public/chat-tool-blocks.js");
await import("../../public/chat-message.js");

describe("ChatMessage Image Rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="chat-messages"></div>';
  });

  describe("renderContentBlock for images", () => {
    it("renders image block with base64 data", () => {
      const imageBlock = {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      };

      const el = window.ChatMessage.renderContentBlock(imageBlock, "assistant");

      expect(el).not.toBeNull();
      expect(el.tagName).toBe("DIV");
      expect(el.className).toContain("chat-image");

      const img = el.querySelector("img");
      expect(img).not.toBeNull();
      expect(img.src).toContain("data:image/png;base64,");
      expect(img.alt).toBe("Image");
    });

    it("renders image block with url source", () => {
      const imageBlock = {
        type: "image",
        source: {
          type: "url",
          url: "https://example.com/image.png",
        },
      };

      const el = window.ChatMessage.renderContentBlock(imageBlock, "assistant");

      expect(el).not.toBeNull();
      expect(el.className).toContain("chat-image");

      const img = el.querySelector("img");
      expect(img).not.toBeNull();
      expect(img.src).toBe("https://example.com/image.png");
    });

    it("handles unknown image source type gracefully", () => {
      const imageBlock = {
        type: "image",
        source: {
          type: "unknown_type",
          data: "some data",
        },
      };

      const el = window.ChatMessage.renderContentBlock(imageBlock, "assistant");

      // Should still render something, just not the image
      expect(el).not.toBeNull();
    });
  });

  describe("renderHistoryMessage with images", () => {
    it("renders message containing image block", () => {
      const msg = {
        role: "assistant",
        content: [
          { type: "text", text: "Here is an image:" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          },
        ],
        timestamp: Date.now(),
      };

      const el = window.ChatMessage.renderHistoryMessage(msg);

      expect(el).not.toBeNull();
      expect(el.className).toContain("assistant");

      const images = el.querySelectorAll(".chat-image");
      expect(images.length).toBe(1);
    });

    it("renders multiple images in one message", () => {
      const msg = {
        role: "assistant",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "def456" } },
        ],
      };

      const el = window.ChatMessage.renderHistoryMessage(msg);

      const images = el.querySelectorAll(".chat-image");
      expect(images.length).toBe(2);
    });

    it("shows placeholder for history messages with missing image data", () => {
      const msg = {
        role: "assistant",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              // Note: data is missing
            },
          },
        ],
      };

      const el = window.ChatMessage.renderHistoryMessage(msg);

      // Should show placeholder when image data is missing
      const placeholder = el.querySelector(".chat-image-placeholder");
      expect(placeholder).not.toBeNull();
    });
  });

  describe("image styling", () => {
    it("applies proper CSS classes to image elements", () => {
      const imageBlock = {
        type: "image",
        source: {
          type: "url",
          url: "https://example.com/test.png",
        },
      };

      const el = window.ChatMessage.renderContentBlock(imageBlock, "assistant");

      const container = el.closest(".chat-image") || el;
      expect(container.className).toContain("chat-image");
    });
  });
});
