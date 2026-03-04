// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

await import("../../public/chat-ws-batcher.js");

describe("WebSocketMessageBatcher", () => {
  let batcher;
  let mockHandler;

  beforeEach(() => {
    mockHandler = vi.fn();
    batcher = window.WebSocketMessageBatcher;
    batcher.initialize(mockHandler);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    batcher.destroy();
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("initializes with message handler", () => {
      expect(batcher.messageHandler).toBe(mockHandler);
      expect(batcher.batch).toEqual([]);
      expect(batcher.flushTimer).toBeNull();
    });
  });

  describe("message queuing", () => {
    it("adds messages to batch queue", () => {
      const msg1 = { type: "chat-event", data: "test1" };
      const msg2 = { type: "chat-event", data: "test2" };

      batcher.queue(msg1);
      batcher.queue(msg2);

      expect(batcher.batch).toHaveLength(2);
      expect(batcher.batch[0]).toBe(msg1);
      expect(batcher.batch[1]).toBe(msg2);
    });

    it("starts flush timer on first message", () => {
      batcher.queue({ type: "test" });

      expect(batcher.flushTimer).not.toBeNull();
    });

    it("does not start multiple timers for rapid messages", () => {
      batcher.queue({ type: "test1" });
      const firstTimer = batcher.flushTimer;

      batcher.queue({ type: "test2" });
      const secondTimer = batcher.flushTimer;

      expect(firstTimer).toBe(secondTimer);
    });
  });

  describe("batch flushing", () => {
    it("flushes batch after BATCH_INTERVAL (50ms)", () => {
      batcher.queue({ type: "test1" });
      batcher.queue({ type: "test2" });

      expect(mockHandler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(50);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith([{ type: "test1" }, { type: "test2" }]);
    });

    it("clears batch after flush", () => {
      batcher.queue({ type: "test" });
      vi.advanceTimersByTime(50);

      expect(batcher.batch).toHaveLength(0);
    });

    it("handles messages arriving during flush", () => {
      batcher.queue({ type: "first" });
      vi.advanceTimersByTime(50);

      // Handler called with first message
      expect(mockHandler).toHaveBeenCalledWith([{ type: "first" }]);

      // New message queued after flush
      batcher.queue({ type: "second" });
      expect(batcher.batch).toHaveLength(1);

      vi.advanceTimersByTime(50);
      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenLastCalledWith([{ type: "second" }]);
    });
  });

  describe("max batch size", () => {
    it("flushes immediately when batch reaches MAX_BATCH_SIZE", () => {
      const MAX_BATCH_SIZE = 50; // From implementation

      // Fill batch to max size
      for (let i = 0; i < MAX_BATCH_SIZE; i++) {
        batcher.queue({ type: "test", index: i });
      }

      // Should flush immediately without waiting for timer
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler.mock.calls[0][0]).toHaveLength(MAX_BATCH_SIZE);

      // Timer should be cleared
      expect(batcher.flushTimer).toBeNull();
    });

    it("continues accepting messages after max batch flush", () => {
      const MAX_BATCH_SIZE = 50;

      // Fill first batch
      for (let i = 0; i < MAX_BATCH_SIZE; i++) {
        batcher.queue({ type: "test", index: i });
      }

      // Add more messages
      batcher.queue({ type: "overflow1" });
      batcher.queue({ type: "overflow2" });

      vi.advanceTimersByTime(50);

      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler.mock.calls[1][0]).toHaveLength(2);
    });
  });

  describe("message deduplication", () => {
    it("deduplicates identical messages within batch window", () => {
      const msg = { type: "chat-event", id: "same-id", data: "test" };

      batcher.queue(msg);
      batcher.queue(msg);
      batcher.queue(msg);

      vi.advanceTimersByTime(50);

      // Should only process one unique message
      expect(mockHandler.mock.calls[0][0]).toHaveLength(1);
    });

    it("keeps different messages separate", () => {
      batcher.queue({ type: "chat-event", id: "1", data: "a" });
      batcher.queue({ type: "chat-event", id: "2", data: "b" });
      batcher.queue({ type: "chat-event", id: "3", data: "c" });

      vi.advanceTimersByTime(50);

      expect(mockHandler.mock.calls[0][0]).toHaveLength(3);
    });
  });

  describe("priority messages", () => {
    it("flushes priority messages immediately", () => {
      batcher.queue({ type: "normal" });

      // Priority message should flush immediately
      batcher.queue({ type: "error", priority: "high" });

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler.mock.calls[0][0]).toEqual([
        { type: "normal" },
        { type: "error", priority: "high" },
      ]);
    });

    it("does not wait for batch interval on priority", () => {
      batcher.queue({ type: "urgent", priority: "high" });

      // Should be called immediately, not after 50ms
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("performance", () => {
    it("batches 100 rapid messages into ≤5 DOM operations", () => {
      const domOps = [];
      const trackingHandler = (batch) => {
        domOps.push(batch.length);
      };

      batcher.initialize(trackingHandler);

      // Simulate 100 rapid messages
      for (let i = 0; i < 100; i++) {
        batcher.queue({ type: "chat-event", data: i });
      }

      // Advance through all batch windows
      vi.advanceTimersByTime(200);

      // Should be batched into fewer operations
      expect(domOps.length).toBeLessThanOrEqual(5);
      expect(domOps.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it("maintains UI responsiveness during high message volume", () => {
      const processingTimes = [];
      const slowHandler = (batch) => {
        const start = performance.now();
        // Simulate some processing
        for (let i = 0; i < 1000; i++) {} // small delay
        processingTimes.push(performance.now() - start);
      };

      batcher.initialize(slowHandler);

      // Queue many messages
      for (let i = 0; i < 50; i++) {
        batcher.queue({ type: "test", data: i });
      }

      vi.advanceTimersByTime(100);

      // Each batch processing should be fast enough to maintain responsiveness
      processingTimes.forEach((time) => {
        expect(time).toBeLessThan(16); // 60fps frame budget
      });
    });

    it("skips perf timing and metrics when HUD perf monitor is disabled", () => {
      const record = vi.fn();
      const nowSpy = vi.spyOn(performance, "now");
      window.HUDApp = {
        perfMonitor: {
          isEnabled: () => false,
          record,
        },
      };

      batcher.queue({ type: "chat-send-ack", id: "ack-disabled" });

      expect(record).not.toHaveBeenCalled();
      expect(nowSpy).not.toHaveBeenCalled();
      nowSpy.mockRestore();
    });

    it("records chatBatcher.flush metrics when HUD perf monitor is enabled", () => {
      const record = vi.fn();
      const nowSpy = vi.spyOn(performance, "now");
      nowSpy.mockReturnValueOnce(10).mockReturnValueOnce(15);
      window.HUDApp = {
        perfMonitor: {
          isEnabled: () => true,
          record,
        },
      };

      batcher.queue({ type: "chat-send-ack", id: "ack-enabled" });

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "chatBatcher.flush",
          batchSize: 1,
          durationMs: 5,
        }),
      );
      nowSpy.mockRestore();
    });
  });

  describe("cleanup", () => {
    it("clears pending timer on destroy", () => {
      batcher.queue({ type: "test" });
      expect(batcher.flushTimer).not.toBeNull();

      batcher.destroy();

      expect(batcher.flushTimer).toBeNull();
      expect(batcher.batch).toHaveLength(0);
    });

    it("does not call handler after destroy", () => {
      batcher.queue({ type: "test" });
      batcher.destroy();

      vi.advanceTimersByTime(100);

      expect(mockHandler).not.toHaveBeenCalled();
    });
  });
});
