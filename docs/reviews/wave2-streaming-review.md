# Wave 2 Chat Streaming JS Fixes — Code Review

## Summary
The `gpu/wave2-chat-streaming` branch successfully implements several crucial performance optimizations for the chat UI. The switch to `DocumentFragment` batching for history load and the LRU caching for markdown rendering are solid improvements. Replacing `innerHTML` serialization with `replaceChildren` in the virtual scroller is an excellent fix that restores DOM event safety and efficiency.

However, the implementation of the `requestAnimationFrame` (rAF) autoscroll logic introduces a critical regression that completely breaks the "force scroll to bottom" behavior (e.g., when switching sessions or loading history).

## Files Reviewed

- **`docs/gpu-optimization-plan.md`**: Added successfully.
- **`public/chat-ws/history-log.js`**: Replaced sequential DOM appending with a `DocumentFragment`. Correct and prevents layout thrashing during bulk load.
- **`public/chat-markdown.js`**: Implemented an LRU cache for parsed markdown. The eviction logic (`mdCache.delete(mdCache.keys().next().value)`) and the re-insertion on cache hits are correctly implemented and bounded to 500 entries, preventing memory leaks in long sessions.
- **`public/chat-messages.js`**: Replaced the expensive `el.innerHTML = messageEl.innerHTML` serialization with `el.replaceChildren(...messageEl.childNodes)`. This safely moves the actual DOM elements into the virtualized container, preserving interactive components (like copy buttons) while eliminating a major source of repaints and reparsing.
- **`public/chat-scroll.js`**: Introduced `scheduleAutoScroll` to debounce scroll events using `requestAnimationFrame`. Contains a critical logic bug regarding the `force` flag.

## Issues Found

### Critical
- **`force` scroll is ignored in `chat-scroll.js`**: In `ChatScroll.scrollToBottom(force)`, the `force` parameter indicates we should scroll to the bottom regardless of the user's current scroll position. However, it delegates to `scheduleAutoScroll(_container)` without passing the flag, and `scheduleAutoScroll` hardcodes a check for `!isAtBottom()`. If the user is scrolled up (or if history just loaded and `scrollTop` is 0), `isAtBottom()` is `false`, so `scheduleAutoScroll` returns immediately *without* scrolling.
  - **Impact**: Loading history, switching sessions, or clicking the "Scroll to Bottom" pill will fail to scroll the view down.
  - **Fix**: Update `scheduleAutoScroll` to accept the `force` parameter:
    ```javascript
    function scheduleAutoScroll(container, force) {
      if (scrollQueued) return;
      if (!force && !isAtBottom()) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        scrollQueued = false;
        if (_pill) _pill.classList.remove("visible");
      });
    }
    ```
    And update the callsite in `scrollToBottom` to pass it: `scheduleAutoScroll(_container, force);`.

### Warning
- **Recycle Pool `innerHTML` destruction**: In `chat-messages.js`, `createOrRecycleElement` clears recycled elements via `el.innerHTML = ""`. While `replaceChildren` initially preserves event listeners from `messageEl` inside the virtualized list, `innerHTML = ""` destroys them when the element is recycled. This is memory-safe (the GC cleans them up) because `chat-markdown.js` relies on document-level event delegation for copy buttons, but if any future interactive components add direct listeners, they will be dropped upon recycle.

### Suggestions
- **Syntax Consistency**: `chat-scroll.js` mixes ES5 `var` with an ES6 arrow function (`requestAnimationFrame(() => { ... })`). Since the rest of the file uses ES5 syntax, it's better to stick to `function()` for consistency, though this doesn't impact modern browsers.

## Verdict
FAIL — Needs fix for the `chat-scroll.js` critical bug before merging to prevent a broken scrolling experience.