// Chat Progressive Render Module — Chunked rendering for large tool results
(function () {
  "use strict";

  const CHUNK_THRESHOLD = 10000; // 10KB - threshold for progressive rendering
  const MIN_CHUNK_SIZE = 1000;
  const MAX_CHUNK_SIZE = 50000;
  const CHUNK_DELAY = 16; // ~60fps

  function ProgressiveToolRenderer() {
    this.activeRenders = new Map();
    this.renderId = 0;
  }

  ProgressiveToolRenderer.prototype.calculateChunkSize = function (contentLength) {
    if (contentLength <= CHUNK_THRESHOLD) {
      return contentLength;
    }
    // Scale chunk size with content: larger content gets larger chunks
    // but capped at MAX_CHUNK_SIZE
    const scaled = Math.floor(contentLength / 5);
    return Math.max(MIN_CHUNK_SIZE, Math.min(scaled, MAX_CHUNK_SIZE));
  };

  ProgressiveToolRenderer.prototype.render = function (container, content) {
    const id = ++this.renderId;
    const contentLength = content.length;

    // Small content - render immediately
    if (contentLength <= CHUNK_THRESHOLD) {
      this.renderImmediate(container, content);
      return { id, completed: true };
    }

    // Large content - render progressively
    const chunkSize = this.calculateChunkSize(contentLength);
    const totalChunks = Math.ceil(contentLength / chunkSize);

    const renderOp = {
      id,
      container,
      content,
      chunkSize,
      totalChunks,
      currentChunk: 0,
      completed: false,
      aborted: false,
      animationFrames: [],
      timeouts: [],
    };

    this.activeRenders.set(id, renderOp);

    // Set up container structure
    this.setupProgressiveContainer(container, contentLength);

    // Start progressive rendering
    this.renderNextChunk(renderOp);

    return renderOp;
  };

  ProgressiveToolRenderer.prototype.setupProgressiveContainer = function (container, totalLength) {
    container.innerHTML = "";

    // Progress indicator
    const progressIndicator = document.createElement("div");
    progressIndicator.className = "progress-indicator";
    progressIndicator.innerHTML = `
      <div class="progress-label">Loading large result...</div>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
      <div class="progress-stats">0 / ${this.formatBytes(totalLength)}</div>
    `;
    container.appendChild(progressIndicator);

    // Content container (initially empty)
    const contentEl = document.createElement("div");
    contentEl.className = "chat-tool-result-content";
    contentEl.style.display = "none";
    container.appendChild(contentEl);
  };

  ProgressiveToolRenderer.prototype.renderNextChunk = function (renderOp) {
    if (renderOp.aborted || renderOp.completed) {
      return;
    }

    const { container, content, chunkSize, currentChunk, totalChunks } = renderOp;
    const start = currentChunk * chunkSize;
    const end = Math.min(start + chunkSize, content.length);
    const chunk = content.slice(start, end);

    const contentEl = container.querySelector(".chat-tool-result-content");
    const progressBar = container.querySelector(".progress-bar");
    const progressStats = container.querySelector(".progress-stats");

    // Append chunk to content
    if (contentEl) {
      contentEl.textContent += chunk;
    }

    // Update progress
    const progress = Math.round(((currentChunk + 1) / totalChunks) * 100);
    if (progressBar) {
      progressBar.style.width = progress + "%";
    }
    if (progressStats) {
      progressStats.textContent = `${this.formatBytes(end)} / ${this.formatBytes(content.length)}`;
    }

    renderOp.currentChunk++;

    if (renderOp.currentChunk >= totalChunks) {
      // Complete
      this.completeRender(renderOp);
    } else {
      // Schedule next chunk using requestAnimationFrame for smooth UI
      const rafId = requestAnimationFrame(() => {
        const timeoutId = setTimeout(() => {
          this.renderNextChunk(renderOp);
        }, CHUNK_DELAY);
        renderOp.timeouts.push(timeoutId);
      });
      renderOp.animationFrames.push(rafId);
    }
  };

  ProgressiveToolRenderer.prototype.completeRender = function (renderOp) {
    renderOp.completed = true;

    const { container, content } = renderOp;

    // Remove progress indicator
    const progressIndicator = container.querySelector(".progress-indicator");
    if (progressIndicator) {
      progressIndicator.remove();
    }

    // Show content
    const contentEl = container.querySelector(".chat-tool-result-content");
    if (contentEl) {
      contentEl.style.display = "";
    }

    // Apply truncation if content is still very large
    const maxDisplayLength = 1000;
    if (content.length > maxDisplayLength && contentEl) {
      const fullContent = contentEl.textContent;
      const truncated = fullContent.slice(0, maxDisplayLength);
      contentEl.textContent = truncated;

      // Add show more button
      const moreBtn = document.createElement("button");
      moreBtn.className = "chat-tool-result-more";
      moreBtn.textContent = "Show more...";

      let expanded = false;
      moreBtn.onclick = function () {
        expanded = !expanded;
        contentEl.textContent = expanded ? fullContent : truncated;
        moreBtn.textContent = expanded ? "Show less" : "Show more...";
      };

      container.appendChild(moreBtn);
    }

    this.activeRenders.delete(renderOp.id);
  };

  ProgressiveToolRenderer.prototype.renderImmediate = function (container, content) {
    // Use existing truncation logic from chat-tool-blocks.js
    const maxDisplayLength = 1000;
    const truncated = content.length > maxDisplayLength;
    const preview = truncated ? content.slice(0, maxDisplayLength) : content;

    container.innerHTML = "";

    const contentEl = document.createElement("div");
    contentEl.className = "chat-tool-result-content";
    contentEl.textContent = preview;
    container.appendChild(contentEl);

    if (truncated) {
      const moreBtn = document.createElement("button");
      moreBtn.className = "chat-tool-result-more";
      moreBtn.textContent = "Show more...";

      let expanded = false;
      moreBtn.onclick = function () {
        expanded = !expanded;
        contentEl.textContent = expanded ? content : preview;
        moreBtn.textContent = expanded ? "Show less" : "Show more...";
      };

      container.appendChild(moreBtn);
    }
  };

  ProgressiveToolRenderer.prototype.abort = function (id) {
    const renderOp = this.activeRenders.get(id);
    if (!renderOp) return;

    renderOp.aborted = true;

    // Cancel all pending animation frames and timeouts
    renderOp.animationFrames.forEach((id) => cancelAnimationFrame(id));
    renderOp.timeouts.forEach((id) => clearTimeout(id));

    // Mark as cancelled in UI
    const { container } = renderOp;
    const progressIndicator = container.querySelector(".progress-indicator");
    if (progressIndicator) {
      progressIndicator.classList.add("progress-cancelled");
      const label = progressIndicator.querySelector(".progress-label");
      if (label) {
        label.textContent = "Loading cancelled";
      }
    }

    this.activeRenders.delete(id);
  };

  ProgressiveToolRenderer.prototype.destroy = function () {
    // Abort all active renders
    this.activeRenders.forEach((renderOp, id) => {
      this.abort(id);
    });
    this.activeRenders.clear();
  };

  ProgressiveToolRenderer.prototype.formatBytes = function (bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  // Expose constants for testing
  ProgressiveToolRenderer.prototype.CHUNK_THRESHOLD = CHUNK_THRESHOLD;
  ProgressiveToolRenderer.prototype.MIN_CHUNK_SIZE = MIN_CHUNK_SIZE;
  ProgressiveToolRenderer.prototype.MAX_CHUNK_SIZE = MAX_CHUNK_SIZE;

  // Export
  window.ProgressiveToolRenderer = new ProgressiveToolRenderer();
})();
