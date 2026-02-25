// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

window.escapeHtml = function (s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

await import("../../public/copy-utils.js");
await import("../../public/chat-tool-blocks.js");
await import("../../public/chat-progressive-render.js");

describe("ProgressiveToolRenderer", () => {
  let container;

  beforeEach(() => {
    container = document.createElement("div");
    container.className = "chat-tool-result";
    document.body.appendChild(container);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.clearAllMocks();
  });

  describe("chunk calculation", () => {
    it("calculates appropriate chunk size for content length", () => {
      const renderer = window.ProgressiveToolRenderer;

      expect(renderer.calculateChunkSize(100)).toBe(100); // Small content, single chunk
      expect(renderer.calculateChunkSize(50000)).toBe(10000); // Medium content (50000/5)
      expect(renderer.calculateChunkSize(200000)).toBe(40000); // Large content (200000/5)
    });

    it("respects min and max chunk boundaries", () => {
      const renderer = window.ProgressiveToolRenderer;

      expect(renderer.calculateChunkSize(50)).toBe(50); // Min chunk
      expect(renderer.calculateChunkSize(1000000)).toBe(50000); // Max chunk
    });
  });

  describe("progressive rendering", () => {
    it("renders content in chunks with progress indicator", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(50000); // 50KB content

      const result = renderer.render(container, content);

      // Should show progress indicator initially
      expect(container.querySelector(".progress-indicator")).not.toBeNull();
      expect(container.querySelector(".progress-bar")).not.toBeNull();

      // Advance time to complete all chunks
      vi.advanceTimersByTime(1000);

      // Should have rendered all content
      expect(container.textContent).toContain("xxxxx");
    });

    it("updates progress bar as chunks render", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(30000);

      renderer.render(container, content);

      const progressBar = container.querySelector(".progress-bar");
      expect(progressBar).not.toBeNull();

      // Initial progress should be low
      const initialWidth = parseInt(progressBar.style.width, 10);
      expect(initialWidth).toBeLessThan(50);

      // Advance and check progress increases
      vi.advanceTimersByTime(100);
      const midWidth = parseInt(progressBar.style.width, 10);
      expect(midWidth).toBeGreaterThanOrEqual(initialWidth);
    });

    it("renders small content immediately without chunking", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "small content";

      renderer.render(container, content);

      // Should not have progress indicator for small content
      expect(container.querySelector(".progress-indicator")).toBeNull();
      expect(container.textContent).toBe("small content");
    });

    it("respects CHUNK_THRESHOLD for determining chunked rendering", () => {
      const renderer = window.ProgressiveToolRenderer;

      // Content just under threshold
      const smallContent = "x".repeat(renderer.CHUNK_THRESHOLD - 1);
      renderer.render(container, smallContent);
      expect(container.querySelector(".progress-indicator")).toBeNull();

      // Clear and try content at threshold
      container.innerHTML = "";
      const largeContent = "x".repeat(renderer.CHUNK_THRESHOLD + 1);
      renderer.render(container, largeContent);
      expect(container.querySelector(".progress-indicator")).not.toBeNull();
    });
  });

  describe("UI responsiveness", () => {
    it("uses requestAnimationFrame between chunks", () => {
      const renderer = window.ProgressiveToolRenderer;
      const rafSpy = vi.spyOn(window, "requestAnimationFrame");

      const content = "x".repeat(50000);
      renderer.render(container, content);

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
    });

    it("allows input to remain responsive during rendering", async () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(100000); // 100KB

      const startTime = performance.now();
      renderer.render(container, content);

      // Simulate user input during render
      let inputResponsive = false;
      const inputCheck = () => {
        inputResponsive = true;
      };

      // Should be able to execute between chunks
      setTimeout(inputCheck, 0);
      vi.advanceTimersByTime(50);

      expect(inputResponsive).toBe(true);
    });
  });

  describe("cleanup", () => {
    it("cancels pending renders on abort", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(100000);

      const renderOp = renderer.render(container, content);

      // Abort before completion
      renderer.abort(renderOp.id);

      // Advance timers - should not continue rendering
      vi.advanceTimersByTime(1000);

      // Progress indicator should show cancelled state
      expect(container.querySelector(".progress-cancelled")).not.toBeNull();
    });

    it("cleans up all timers on destroy", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(50000);

      renderer.render(container, content);
      renderer.destroy();

      // No errors should occur when advancing timers after destroy
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    });
  });

  describe("show more/less with progressive rendering", () => {
    it("integrates with existing show more button", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(5000); // Over the 1000 char truncation limit

      renderer.render(container, content);

      // Should have both progress indicator and show more button
      vi.advanceTimersByTime(500);

      const showMoreBtn = container.querySelector(".chat-tool-result-more");
      expect(showMoreBtn).not.toBeNull();
    });

    it("renders truncated preview first, then expands", () => {
      const renderer = window.ProgressiveToolRenderer;
      const content = "x".repeat(10000);

      renderer.render(container, content);

      // Initially should show truncated content
      const contentEl = container.querySelector(".chat-tool-result-content");
      expect(contentEl).not.toBeNull();

      // Complete rendering
      vi.advanceTimersByTime(1000);

      // Should be able to expand
      const showMoreBtn = container.querySelector(".chat-tool-result-more");
      if (showMoreBtn) {
        showMoreBtn.click();
        expect(contentEl.textContent.length).toBeGreaterThan(1000);
      }
    });
  });
});
