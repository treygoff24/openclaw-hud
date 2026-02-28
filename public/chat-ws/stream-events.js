(function () {
  "use strict";

  function handleChatEvent(data) {
    var s = window.ChatState;
    var runtime = window.ChatWsRuntime;
    var p = data.payload;
    if (!p || !s.currentSession || p.sessionKey !== s.currentSession.sessionKey) return;

    var container = document.getElementById("chat-messages");
    if (!container) return;

    if (p.state === "delta" || p.state === "final") {
      var run = s.activeRuns.get(p.runId);
      if (!run) {
        var el = window.ChatMessage.createAssistantStreamEl();
        container.appendChild(el);
        run = { el: el, lastSeq: 0 };
        s.activeRuns.set(p.runId, run);
      }
      if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0) {
        console.warn("Gap detected: expected seq " + (run.lastSeq + 1) + " got " + p.seq);
      }
      if (p.seq) run.lastSeq = p.seq;
      if (p.message) {
        var contentEl = run.el.querySelector(".chat-msg-content");
        if (contentEl) {
          var text = window.ChatMessage.extractText(p.message);
          if (p.state === "final" && window.ChatMarkdown) {
            contentEl.innerHTML = window.ChatMarkdown.renderMarkdown(text);
          } else {
            contentEl.textContent = text;
          }
        }
      }
      if (p.state === "final") {
        run.el.classList.remove("streaming");
        run.el.classList.add("final");
        s.activeRuns.delete(p.runId);
      }
      runtime.updateButtons();
      if (window.ChatScroll) window.ChatScroll.scrollToBottom(false);
      return;
    }

    if (p.state === "error") {
      var errEl = document.createElement("div");
      errEl.className = "chat-msg error";
      errEl.textContent = p.errorMessage || "Unknown error";
      errEl.appendChild(
        runtime.createRetryBtn(s.currentSession ? s.currentSession.sessionKey : "", "", errEl),
      );
      container.appendChild(errEl);
      s.activeRuns.delete(p.runId);
      runtime.updateButtons();
      return;
    }

    if (p.state === "aborted") {
      var run2 = s.activeRuns.get(p.runId);
      if (run2) {
        run2.el.classList.remove("streaming");
        run2.el.classList.add("aborted");
        var badge = document.createElement("span");
        badge.className = "chat-aborted-badge";
        badge.textContent = "Aborted: " + (p.stopReason || "unknown");
        run2.el.appendChild(badge);
        s.activeRuns.delete(p.runId);
      }
      runtime.updateButtons();
    }
  }

  function processChatEventBatch(batch) {
    var s = window.ChatState;
    var runtime = window.ChatWsRuntime;
    var container = document.getElementById("chat-messages");
    if (!container || !s.currentSession) return;

    var fragment = document.createDocumentFragment();
    var needsScroll = false;
    var assistantMessageCount = 0;

    batch.forEach(function (data) {
      if (data.type !== "chat-event") return;

      var p = data.payload;
      if (!p || p.sessionKey !== s.currentSession.sessionKey) return;

      if (p.state === "delta" || p.state === "final") {
        var run = s.activeRuns.get(p.runId);
        if (!run) {
          var el = window.ChatMessage.createAssistantStreamEl();
          fragment.appendChild(el);
          run = { el: el, lastSeq: 0 };
          s.activeRuns.set(p.runId, run);
        }
        if (p.seq && p.seq > run.lastSeq + 1 && run.lastSeq > 0) {
          console.warn("Gap detected: expected seq " + (run.lastSeq + 1) + " got " + p.seq);
        }
        if (p.seq) run.lastSeq = p.seq;
        if (p.message) {
          var contentEl = run.el.querySelector(".chat-msg-content");
          if (contentEl) {
            var text = window.ChatMessage.extractText(p.message);
            if (p.state === "final" && window.ChatMarkdown) {
              contentEl.innerHTML = window.ChatMarkdown.renderMarkdown(text);
            } else {
              contentEl.textContent = text;
            }
          }
        }
        if (p.state === "final") {
          run.el.classList.remove("streaming");
          run.el.classList.add("final");
          s.activeRuns.delete(p.runId);
          assistantMessageCount++;
        }
        needsScroll = true;
      }
    });

    if (fragment.childNodes.length > 0) {
      container.appendChild(fragment);
    }

    if (assistantMessageCount > 0 && window.A11yAnnouncer) {
      window.A11yAnnouncer.announce(
        assistantMessageCount + " new assistant message" + (assistantMessageCount > 1 ? "s" : ""),
        "chat-messages",
        500,
      );
    }

    if (needsScroll) {
      runtime.updateButtons();
      if (window.ChatScroll) window.ChatScroll.scrollToBottom(false);
    }
  }

  function initializeBatcher() {
    if (window.WebSocketMessageBatcher) {
      window.WebSocketMessageBatcher.initialize(processChatEventBatch);
    }
  }

  window.ChatWsStreamEvents = {
    handleChatEvent: handleChatEvent,
    processChatEventBatch: processChatEventBatch,
    initializeBatcher: initializeBatcher,
  };
})();
