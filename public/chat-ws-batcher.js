// Chat WebSocket Batcher Module — Batches rapid WS messages for performance
(function () {
  "use strict";

  const BATCH_INTERVAL = 50; // 50ms batch window
  const MAX_BATCH_SIZE = 50; // Flush immediately if batch gets too large
  const hasPerformanceNow =
    typeof performance !== "undefined" && typeof performance.now === "function";

  function resolvePerfMonitor() {
    const monitor = window.HUDApp && window.HUDApp.perfMonitor;
    if (!monitor) return null;
    if (typeof monitor.isEnabled === "function" && !monitor.isEnabled()) return null;
    if (typeof monitor.record !== "function") return null;
    return monitor;
  }

  function recordPerf(entry) {
    const monitor = resolvePerfMonitor();
    if (!monitor) return;
    try {
      monitor.record(entry);
    } catch {
      // Ignore perf monitor failures for runtime behavior.
    }
  }

  function WebSocketMessageBatcher() {
    this.messageHandler = null;
    this.batch = [];
    this.flushTimer = null;
    this.processedIds = new Set(); // For deduplication
    this.isProcessing = false;
  }

  WebSocketMessageBatcher.prototype.initialize = function (messageHandler) {
    this.messageHandler = messageHandler;
    this.batch = [];
    this.processedIds.clear();
    return this;
  };

  WebSocketMessageBatcher.prototype.queue = function (message) {
    if (!message) return;

    // Deduplication: skip if we've already processed this message ID
    if (message.id && this.processedIds.has(message.id)) {
      return;
    }

    // Check for high priority messages
    const isPriority =
      message.priority === "high" || message.type === "error" || message.type === "chat-send-ack";

    if (isPriority) {
      // Add to current batch and flush immediately
      this.batch.push(message);
      if (message.id) {
        this.processedIds.add(message.id);
      }
      this.flush();
      return;
    }

    // Normal message: add to batch
    this.batch.push(message);
    if (message.id) {
      this.processedIds.add(message.id);
    }

    // Start flush timer if not already running
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, BATCH_INTERVAL);
    }

    // Flush immediately if batch is full
    if (this.batch.length >= MAX_BATCH_SIZE) {
      this.flush();
    }
  };

  WebSocketMessageBatcher.prototype.flush = function () {
    if (this.isProcessing || this.batch.length === 0) {
      return;
    }
    const shouldRecordPerf = Boolean(resolvePerfMonitor());

    this.isProcessing = true;

    // Clear timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Copy and clear batch atomically
    const currentBatch = this.batch.slice();
    this.batch = [];
    const flushStartedAt = shouldRecordPerf
      ? hasPerformanceNow
        ? performance.now()
        : Date.now()
      : null;

    // Process batch
    if (this.messageHandler) {
      try {
        this.messageHandler(currentBatch);
      } catch (err) {
        console.error("[WS Batcher] Error processing batch:", err);
      }
    }

    // Limit processed IDs cache size
    if (this.processedIds.size > 1000) {
      const idsArray = Array.from(this.processedIds);
      this.processedIds = new Set(idsArray.slice(-500));
    }

    if (shouldRecordPerf) {
      const flushFinishedAt = hasPerformanceNow ? performance.now() : Date.now();
      recordPerf({
        name: "chatBatcher.flush",
        batchSize: currentBatch.length,
        durationMs: flushFinishedAt - flushStartedAt,
      });
    }

    this.isProcessing = false;
  };

  WebSocketMessageBatcher.prototype.destroy = function () {
    // Clear any pending timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Clear pending batch (don't process)
    this.batch = [];
    this.processedIds.clear();
    this.messageHandler = null;
    this.isProcessing = false;
  };

  // Stats for debugging
  WebSocketMessageBatcher.prototype.getStats = function () {
    return {
      pendingMessages: this.batch.length,
      hasPendingTimer: this.flushTimer !== null,
      processedIdsCache: this.processedIds.size,
    };
  };

  // Export
  window.WebSocketMessageBatcher = new WebSocketMessageBatcher();
})();
