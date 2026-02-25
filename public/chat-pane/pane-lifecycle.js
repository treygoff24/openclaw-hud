(function () {
  "use strict";
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});

  function openChatPane(agentId, sessionId, label, sessionKey) {
    if (!agentId) return;
    if (!runtime.isCanonicalSessionKey(sessionKey)) {
      throw new Error("openChatPane requires canonical sessionKey from /api/sessions");
    }

    var displaySessionId = sessionId || sessionKey.split(":").slice(2).join(":");
    runtime.clearHistoryLoadTimer();

    var state = runtime.ChatState;
    if (state.subscribedKey === sessionKey) return;

    var layout = document.querySelector(".hud-layout");
    if (layout) layout.classList.add("chat-open");

    var titleEl = document.getElementById("chat-title");
    if (titleEl)
      titleEl.textContent =
        agentId + " // " + runtime.normalizeLabel(label, displaySessionId.slice(0, 8));

    var exportBtn = document.getElementById("chat-export-btn");
    if (!exportBtn) {
      exportBtn = document.createElement("button");
      exportBtn.id = "chat-export-btn";
      exportBtn.className = "chat-export-btn";
      exportBtn.setAttribute("aria-label", "Export session to markdown");
      exportBtn.title = "Export session to markdown";
      exportBtn.textContent = "⬇ Export";
      exportBtn.onclick = function () {
        window.exportChatSession();
      };
      var header = document.querySelector(".chat-header");
      var closeBtn = document.getElementById("chat-close");
      if (header && closeBtn) header.insertBefore(exportBtn, closeBtn);
    }

    var liveEl = document.getElementById("chat-live");
    if (liveEl) liveEl.classList.remove("visible");

    if (state.subscribedKey) {
      runtime.sendWs({ type: "chat-unsubscribe", sessionKey: state.subscribedKey });
      if (state.currentSession && state.currentSession.sessionId) {
        runtime.sendWs({ type: "unsubscribe-log", sessionId: state.currentSession.sessionId });
      }
      if (state.resetHistoryLoadState) {
        state.resetHistoryLoadState(state.subscribedKey);
      }
    }

    var enriched = runtime.enrichSessionMetadata(agentId, sessionId, label, sessionKey);
    state.currentSession = Object.assign({}, enriched.currentSession);
    state.subscribedKey = sessionKey;
    state.currentMessages = [];
    localStorage.setItem("hud-chat-session", JSON.stringify(state.currentSession));

    var messagesEl = document.getElementById("chat-messages");
    if (messagesEl) {
      while (messagesEl.firstChild) messagesEl.removeChild(messagesEl.firstChild);
      delete messagesEl.dataset.ready;
      var loading = document.createElement("div");
      loading.className = "chat-loading";
      loading.textContent = "Loading...";
      messagesEl.appendChild(loading);
    }

    state.activeRuns.clear();
    if (window.ChatWsHandler) window.ChatWsHandler.updateButtons();

    runtime.sendWs({ type: "chat-subscribe", sessionKey: sessionKey });
    if (typeof runtime.requestChatHistory === "function") {
      runtime.requestChatHistory(sessionKey, "open_chat_pane", { force: true });
    } else {
      runtime.sendWs({ type: "chat-history", sessionKey: sessionKey });
      runtime.startHistoryLoadTimer(sessionKey);
    }
  }

  function closeChatPane() {
    runtime.clearHistoryLoadTimer();

    var state = runtime.ChatState;
    var layout = document.querySelector(".hud-layout");
    if (layout) layout.classList.remove("chat-open");

    if (state.subscribedKey) {
      runtime.sendWs({ type: "chat-unsubscribe", sessionKey: state.subscribedKey });
      if (state.currentSession) {
        runtime.sendWs({ type: "unsubscribe-log", sessionId: state.currentSession.sessionId });
      }
      if (state.resetHistoryLoadState) {
        state.resetHistoryLoadState(state.subscribedKey);
      }
      state.subscribedKey = null;
    }

    state.currentSession = null;
    state.activeRuns.clear();

    if (window.VirtualScroller) window.VirtualScroller.destroy();
    if (window.ProgressiveToolRenderer) window.ProgressiveToolRenderer.destroy();
    if (window.WebSocketMessageBatcher) window.WebSocketMessageBatcher.destroy();

    if (window.ChatWsHandler) window.ChatWsHandler.updateButtons();
    localStorage.removeItem("hud-chat-session");
  }

  runtime.openChatPane = openChatPane;
  runtime.closeChatPane = closeChatPane;
})();
