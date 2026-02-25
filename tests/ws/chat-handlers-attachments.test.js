import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let mod;
const MAIN_KEY = "agent:agent1:main";

beforeEach(() => {
  // Clear cache to get fresh Maps each time
  const keys = Object.keys(require.cache).filter((k) => k.includes("chat-handlers"));
  for (const k of keys) delete require.cache[k];
  mod = require("../../ws/chat-handlers");
});

afterEach(() => {
  // Clear any rate limit state
  vi.restoreAllMocks();
});

function mockWs(readyState = 1) {
  return { readyState, send: vi.fn() };
}

function mockGateway(connected = true) {
  return {
    connected,
    on: vi.fn(),
    request: vi.fn().mockResolvedValue({}),
  };
}

describe("chat-handlers attachments", () => {
  describe("handleChatMessage with attachments", () => {
    it("chat-send with attachments sends content blocks to gateway", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      const base64Image =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Check this image",
          attachments: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Image,
              },
            },
          ],
          idempotencyKey: "ik1",
        },
        gw,
      );

      // Verify the gateway was called with content blocks
      expect(gw.request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({
          sessionKey: MAIN_KEY,
          content: expect.arrayContaining([
            expect.objectContaining({ type: "text" }),
            expect.objectContaining({ type: "image" }),
          ]),
        }),
      );
    });

    it("chat-send with multiple attachments sends all to gateway", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Two images",
          attachments: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "img1" } },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "img2" } },
          ],
          idempotencyKey: "ik2",
        },
        gw,
      );

      const callArgs = gw.request.mock.calls[0];
      const content = callArgs[1].content;
      expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    });

    it("chat-send without attachments works normally", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Hello world",
          idempotencyKey: "ik4",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);

      // Should send as text content block
      expect(gw.request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({
          sessionKey: MAIN_KEY,
          content: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "Hello world" }),
          ]),
        }),
      );
    });

    it("chat-send rejects attachments larger than 10MB", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      // Large base64 string that would exceed 10MB when decoded
      // base64 expands by ~1.33x, so 14M characters = ~10.5MB decoded
      const largeData = "A".repeat(14 * 1024 * 1024);

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Large image",
          attachments: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: largeData } },
          ],
          idempotencyKey: "ik3",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("ATTACHMENT_TOO_LARGE");
      expect(sent.error.message).toContain("10MB");
    });

    it("chat-send with only attachments (no text) works", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "",
          attachments: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "small" } },
          ],
          idempotencyKey: "ik5",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
    });

    it("chat-send rejects non-image attachments", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "File",
          attachments: [
            {
              type: "file",
              source: { type: "base64", media_type: "application/pdf", data: "abc" },
            },
          ],
          idempotencyKey: "ik6",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("INVALID_ATTACHMENT_TYPE");
    });

    it("chat-send accepts valid image media types (png, jpeg, gif, webp)", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      const validTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];

      for (const mediaType of validTypes) {
        vi.clearAllMocks();

        await mod.handleChatMessage(
          ws,
          {
            type: "chat-send",
            sessionKey: MAIN_KEY,
            message: `Test ${mediaType}`,
            attachments: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: "small" } },
            ],
            idempotencyKey: `ik-${mediaType}`,
          },
          gw,
        );

        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.ok).toBe(true);
        expect(sent.error).toBeUndefined();
      }
    });

    it("chat-send rejects text/html media type", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Malicious",
          attachments: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "text/html",
                data: "<script>alert(1)</script>",
              },
            },
          ],
          idempotencyKey: "ik-html",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("INVALID_MEDIA_TYPE");
      expect(sent.error.message).toContain("text/html");
    });

    it("chat-send rejects image/svg+xml media type (SVG can contain scripts)", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "SVG",
          attachments: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/svg+xml",
                data: "<svg><script>alert(1)</script></svg>",
              },
            },
          ],
          idempotencyKey: "ik-svg",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("INVALID_MEDIA_TYPE");
      expect(sent.error.message).toContain("image/svg+xml");
    });

    it("chat-send rejects attachments with missing media_type", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "No media type",
          attachments: [{ type: "image", source: { type: "base64", data: "nodata" } }],
          idempotencyKey: "ik-nomedia",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("INVALID_MEDIA_TYPE");
    });

    it("chat-send rejects attachments with missing source", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "No source",
          attachments: [{ type: "image" }],
          idempotencyKey: "ik-nosource",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("INVALID");
      expect(sent.error.message).toBe("attachment missing source");
    });

    it("chat-send rejects base64 attachments with missing data", async () => {
      const ws = mockWs();
      const gw = mockGateway();

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "No base64 data",
          attachments: [{ type: "image", source: { type: "base64", media_type: "image/png" } }],
          idempotencyKey: "ik-nodata",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("INVALID");
      expect(sent.error.message).toBe("attachment missing data");
    });

    it("chat-send with whitespace-only message and attachments sends only image blocks", async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: "r9", status: "queued" });

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "   ",
          attachments: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "tiny" } },
          ],
          idempotencyKey: "ik-whitespace",
        },
        gw,
      );

      const payload = gw.request.mock.calls[0][1];
      expect(payload.content).toHaveLength(1);
      expect(payload.content[0].type).toBe("image");
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
    });
  });

  describe("attachment rate limiting", () => {
    it("allows normal attachment sends", async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      const base64Image =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "First image",
          attachments: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: base64Image },
            },
          ],
          idempotencyKey: "ratetest1",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
    });

    it("rejects 6th attachment within 60s", async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      const base64Image =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      // First 5 should succeed
      for (let i = 1; i <= 5; i++) {
        await mod.handleChatMessage(
          ws,
          {
            type: "chat-send",
            sessionKey: MAIN_KEY,
            message: `Image ${i}`,
            attachments: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: base64Image },
              },
            ],
            idempotencyKey: `ratetest-${i}`,
          },
          gw,
        );

        const sent = JSON.parse(ws.send.mock.calls[i - 1][0]);
        expect(sent.ok).toBe(true);
      }

      // 6th should fail with rate limit error
      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Too many images",
          attachments: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: base64Image },
            },
          ],
          idempotencyKey: "ratetest-6",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[5][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe("RATE_LIMITED");
      expect(sent.error.message).toBe("Too many attachment uploads");
    });

    it("non-attachment messages are not rate limited", async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      // First 5 attachment messages should succeed and use rate limit
      const base64Image =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      for (let i = 1; i <= 5; i++) {
        await mod.handleChatMessage(
          ws,
          {
            type: "chat-send",
            sessionKey: MAIN_KEY,
            message: `Image ${i}`,
            attachments: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: base64Image },
              },
            ],
            idempotencyKey: `notlimited-${i}`,
          },
          gw,
        );
      }

      // Now rate limited, but text-only messages should still work
      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Text message should still work",
          idempotencyKey: "notlimited-text",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[5][0]);
      expect(sent.ok).toBe(true);
    });

    it("rate limit is per-connection (different ws objects)", async () => {
      const ws1 = mockWs();
      const ws2 = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });

      const base64Image =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      // Fill up rate limit for ws1
      for (let i = 1; i <= 5; i++) {
        await mod.handleChatMessage(
          ws1,
          {
            type: "chat-send",
            sessionKey: MAIN_KEY,
            message: `Image ${i}`,
            attachments: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/png", data: base64Image },
              },
            ],
            idempotencyKey: `perconn1-${i}`,
          },
          gw,
        );
      }

      // ws1 should be rate limited
      await mod.handleChatMessage(
        ws1,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "Too many",
          attachments: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: base64Image },
            },
          ],
          idempotencyKey: "perconn1-6",
        },
        gw,
      );

      let sent = JSON.parse(ws1.send.mock.calls[5][0]);
      expect(sent.error.code).toBe("RATE_LIMITED");

      // ws2 should NOT be rate limited (different connection)
      await mod.handleChatMessage(
        ws2,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "First image on ws2",
          attachments: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: base64Image },
            },
          ],
          idempotencyKey: "perconn2-1",
        },
        gw,
      );

      sent = JSON.parse(ws2.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
    });

    it("evicts old timestamps outside the rate-limit window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-24T12:00:00.000Z"));

      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: "r1", status: "queued" });
      const attachment = [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
      ];

      for (let i = 1; i <= 5; i++) {
        await mod.handleChatMessage(
          ws,
          {
            type: "chat-send",
            sessionKey: MAIN_KEY,
            message: `Image ${i}`,
            attachments: attachment,
            idempotencyKey: `window-${i}`,
          },
          gw,
        );
      }

      vi.advanceTimersByTime(mod.RATE_LIMIT_WINDOW_MS + 1);

      await mod.handleChatMessage(
        ws,
        {
          type: "chat-send",
          sessionKey: MAIN_KEY,
          message: "After window",
          attachments: attachment,
          idempotencyKey: "window-6",
        },
        gw,
      );

      const sent = JSON.parse(ws.send.mock.calls[5][0]);
      expect(sent.ok).toBe(true);
      vi.useRealTimers();
    });
  });
});
