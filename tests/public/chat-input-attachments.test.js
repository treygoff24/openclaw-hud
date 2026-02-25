// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

window.escapeHtml = function (s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};
window.marked = { parse: vi.fn((t) => "<p>" + t + "</p>"), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn((t) => t), addHook: vi.fn() };

window.ChatState = {
  currentSession: { sessionKey: "agent:test:main", agentId: "test-agent" },
  sendWs: vi.fn(),
  pendingAcks: new Map(),
  cachedModels: null,
};

window.ChatCommands = {
  search: vi.fn().mockReturnValue([]),
  find: vi.fn().mockReturnValue(null),
  execute: vi.fn().mockReturnValue(null),
};

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

describe("ChatInput Attachments", () => {
  let originalFileReader;

  beforeEach(() => {
    vi.clearAllMocks();
    window.ChatState.pendingAcks = new Map();
    document.body.innerHTML = `
      <div id="chat-messages"></div>
      <div id="chat-input-area">
        <textarea id="chat-input" placeholder="Type a message..."></textarea>
        <button id="chat-send-btn">▶</button>
        <button id="chat-attach-btn">📎</button>
      </div>
    `;
    window.ChatInput._clearAttachments();
    window.ChatInput._initAttachments();
  });

  afterEach(() => {
    if (originalFileReader) {
      globalThis.FileReader = originalFileReader;
      originalFileReader = null;
    }
  });

  it("creates hidden file input element", () => {
    const fileInput = document.getElementById("file-input");
    expect(fileInput).not.toBeNull();
    expect(fileInput.type).toBe("file");
    expect(fileInput.accept).toBe("image/*");
    expect(fileInput.multiple).toBe(true);
    expect(fileInput.style.display).toBe("none");
  });

  it("triggers file input click when attach button is clicked", () => {
    const attachBtn = document.getElementById("chat-attach-btn");
    const fileInput = document.getElementById("file-input");
    const clickSpy = vi.spyOn(fileInput, "click");

    attachBtn.click();

    expect(clickSpy).toHaveBeenCalled();
  });

  it("rejects files larger than 5MB", () => {
    const bigFile = new File(["x".repeat(6 * 1024 * 1024)], "big.png", { type: "image/png" });
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    expect(window.ChatInput._validateFile(bigFile)).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("5MB"));

    alertSpy.mockRestore();
  });

  it("accepts valid image files", () => {
    const validFile = new File(["fake image data"], "test.png", { type: "image/png" });
    Object.defineProperty(validFile, "size", { value: 1024 * 100 });

    expect(window.ChatInput._validateFile(validFile)).toBe(true);
  });

  it("parses ready attachments for chat-send payload", () => {
    window.ChatInput._pendingAttachments.push({
      id: "ready-1",
      file: { name: "test.png" },
      dataUrl: "data:image/png;base64,QUJDREVGRw==",
    });

    expect(window.ChatInput._getAttachments()).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "QUJDREVGRw==",
        },
      },
    ]);
  });

  it("guards _getAttachments against pending and malformed attachment data", () => {
    window.ChatInput._pendingAttachments.push(
      { id: "pending", file: { name: "pending.png" } },
      { id: "bad", file: { name: "bad.png" }, dataUrl: "not-a-data-url" },
      null,
    );

    expect(() => window.ChatInput._getAttachments()).not.toThrow();
    expect(window.ChatInput._getAttachments()).toEqual([]);
  });

  it("send immediately after file select is safe and deterministic while read is pending", async () => {
    const readers = [];
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
        readers.push(this);
      }
      readAsDataURL() {}
    };

    const fileInput = document.getElementById("file-input");
    const file = new File(["img-bytes"], "quick.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 1024 });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    const input = document.getElementById("chat-input");
    input.value = "send now";

    expect(() => window.ChatInput.sendMessage()).not.toThrow();
    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(1);
    expect(window.ChatState.sendWs.mock.calls[0][0]).toMatchObject({
      type: "chat-send",
      message: "send now",
    });
    expect(window.ChatState.sendWs.mock.calls[0][0].attachments).toBeUndefined();
    expect(window.ChatInput._pendingAttachments).toHaveLength(1);

    readers[0].onload({ target: { result: "data:image/png;base64,SEVMTE8=" } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    input.disabled = false;
    input.value = "send with image";
    window.ChatInput.sendMessage();

    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(2);
    expect(window.ChatState.sendWs.mock.calls[1][0].attachments).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "SEVMTE8=",
        },
      },
    ]);
    expect(window.ChatInput._pendingAttachments).toHaveLength(0);
  });

  it("removes failed attachment on FileReader error and keeps send path safe", async () => {
    const readers = [];
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.onabort = null;
        readers.push(this);
      }
      readAsDataURL() {}
    };

    const fileInput = document.getElementById("file-input");
    const file = new File(["img-bytes"], "broken.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 1024 });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(window.ChatInput._pendingAttachments).toHaveLength(1);
    expect(() => readers[0].onerror(new Event("error"))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.ChatInput._pendingAttachments).toHaveLength(0);

    const input = document.getElementById("chat-input");
    input.value = "still sends";
    expect(() => window.ChatInput.sendMessage()).not.toThrow();
    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(1);
    expect(window.ChatState.sendWs.mock.calls[0][0]).toMatchObject({
      type: "chat-send",
      message: "still sends",
    });
    expect(window.ChatState.sendWs.mock.calls[0][0].attachments).toBeUndefined();
  });

  it("removes failed attachment on FileReader abort and keeps send path safe", async () => {
    const readers = [];
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.onabort = null;
        readers.push(this);
      }
      readAsDataURL() {}
    };

    const fileInput = document.getElementById("file-input");
    const file = new File(["img-bytes"], "aborted.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 1024 });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(window.ChatInput._pendingAttachments).toHaveLength(1);
    expect(() => readers[0].onabort(new Event("abort"))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.ChatInput._pendingAttachments).toHaveLength(0);

    const input = document.getElementById("chat-input");
    input.value = "after abort";
    expect(() => window.ChatInput.sendMessage()).not.toThrow();
    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(1);
    expect(window.ChatState.sendWs.mock.calls[0][0]).toMatchObject({
      type: "chat-send",
      message: "after abort",
    });
    expect(window.ChatState.sendWs.mock.calls[0][0].attachments).toBeUndefined();
  });

  it("handles mixed attachment outcomes in one file batch and leaves lifecycle state clean", async () => {
    const readers = [];
    originalFileReader = globalThis.FileReader;
    globalThis.FileReader = class MockFileReader {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.onabort = null;
        readers.push(this);
      }
      readAsDataURL() {}
    };

    const fileInput = document.getElementById("file-input");
    const okFile = new File(["ok-bytes"], "ok.png", { type: "image/png" });
    const brokenFile = new File(["bad-bytes"], "broken.png", { type: "image/png" });
    Object.defineProperty(okFile, "size", { value: 1024 });
    Object.defineProperty(brokenFile, "size", { value: 1024 });
    Object.defineProperty(fileInput, "files", { configurable: true, value: [okFile, brokenFile] });

    expect(() => fileInput.dispatchEvent(new Event("change", { bubbles: true }))).not.toThrow();
    expect(window.ChatInput._pendingAttachments).toHaveLength(2);
    expect(readers).toHaveLength(2);

    expect(() => readers[1].onabort(new Event("abort"))).not.toThrow();
    expect(() =>
      readers[0].onload({ target: { result: "data:image/png;base64,T0s=" } }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.ChatInput._pendingAttachments).toHaveLength(1);
    expect(window.ChatInput._pendingAttachments[0].file.name).toBe("ok.png");

    const input = document.getElementById("chat-input");
    input.value = "mixed attachment send";
    expect(() => window.ChatInput.sendMessage()).not.toThrow();

    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(1);
    expect(window.ChatState.sendWs.mock.calls[0][0]).toMatchObject({
      type: "chat-send",
      message: "mixed attachment send",
      attachments: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "T0s=",
          },
        },
      ],
    });
    expect(window.ChatInput._pendingAttachments).toHaveLength(0);
    expect(document.querySelector(".attachment-previews")).toBeNull();
  });

  it("does not throw or send when only pending attachments exist", () => {
    window.ChatInput._pendingAttachments.push({
      id: "pending-only",
      file: { name: "pending-only.png" },
    });

    expect(() => window.ChatInput.sendMessage()).not.toThrow();
    expect(window.ChatState.sendWs).not.toHaveBeenCalled();
    expect(window.ChatInput._pendingAttachments).toHaveLength(1);
  });

  it("sends ready attachments and keeps unread ones queued", () => {
    window.ChatInput._pendingAttachments.push(
      { id: "pending", file: { name: "pending.png" } },
      { id: "ready", file: { name: "ready.png" }, dataUrl: "data:image/png;base64,UkVBRFk=" },
    );

    const input = document.getElementById("chat-input");
    input.value = "mixed send";
    window.ChatInput.sendMessage();

    expect(window.ChatState.sendWs).toHaveBeenCalledTimes(1);
    expect(window.ChatState.sendWs.mock.calls[0][0].attachments).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: "UkVBRFk=",
        },
      },
    ]);
    expect(window.ChatInput._pendingAttachments).toHaveLength(1);
    expect(window.ChatInput._pendingAttachments[0].id).toBe("pending");
  });
});
