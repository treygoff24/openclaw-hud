(function () {
  "use strict";
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});

  function restoreSavedChatSession(sessions) {
    var savedRaw = null;
    try {
      savedRaw = localStorage.getItem("hud-chat-session");
    } catch (e) {
      return false;
    }
    if (!savedRaw) return false;

    var saved = null;
    try {
      saved = JSON.parse(savedRaw);
    } catch (e) {
      localStorage.removeItem("hud-chat-session");
      return false;
    }

    var savedSessionKey = saved && saved.sessionKey;
    if (!runtime.isCanonicalSessionKey(savedSessionKey)) {
      localStorage.removeItem("hud-chat-session");
      return false;
    }

    var list = Array.isArray(sessions) ? sessions : [];
    var matched = list.find(function (session) {
      return session && session.sessionKey === savedSessionKey;
    });

    if (!matched || !runtime.isCanonicalSessionKey(matched.sessionKey)) {
      localStorage.removeItem("hud-chat-session");
      return false;
    }

    var agentId = matched.agentId || saved.agentId;
    if (!agentId) {
      localStorage.removeItem("hud-chat-session");
      return false;
    }

    var sessionId = matched.sessionId || saved.sessionId || "";
    var label = matched.label || saved.label || "";
    window.openChatPane(agentId, sessionId, label, matched.sessionKey);
    return true;
  }

  runtime.restoreSavedChatSession = restoreSavedChatSession;
})();
