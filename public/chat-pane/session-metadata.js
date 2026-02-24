(function() {
  'use strict';
  var runtime = window.ChatPaneRuntime || (window.ChatPaneRuntime = {});
  var constants = runtime.constants;

  function normalizeLabel(value, fallback) {
    return HUD.labelSanitizer.normalizeLabel(value, fallback);
  }

  function isCanonicalSessionKey(sessionKey) {
    return typeof sessionKey === 'string' && constants.CANONICAL_SESSION_KEY_RE.test(sessionKey);
  }

  function findSessionMetadata(agentId, sessionId, sessionKey) {
    var sessions = Array.isArray(window._allSessions) ? window._allSessions : [];
    for (var i = 0; i < sessions.length; i++) {
      var session = sessions[i];
      if (!session || typeof session !== 'object') continue;
      if (session.sessionKey === sessionKey) return session;
    }
    if (agentId && sessionId) {
      for (var j = 0; j < sessions.length; j++) {
        var byIds = sessions[j];
        if (!byIds || typeof byIds !== 'object') continue;
        if (byIds.agentId === agentId && byIds.sessionId === sessionId) return byIds;
      }
    }
    return null;
  }

  function enrichSessionMetadata(agentId, sessionId, label, sessionKey) {
    var sessionMeta = findSessionMetadata(agentId, sessionId, sessionKey) || {};
    var resolveTarget = Object.assign({}, sessionMeta, {
      agentId: sessionMeta.agentId || agentId,
      sessionId: sessionMeta.sessionId || sessionId || '',
      sessionKey: sessionMeta.sessionKey || sessionKey || '',
      label: sessionMeta.label || label || '',
      spawnDepth: sessionMeta.spawnDepth,
      spawnedBy: sessionMeta.spawnedBy,
    });

    var sender = window.ChatSenderResolver.resolveChatSenderDisplay(resolveTarget);

    return {
      sessionMeta: sessionMeta,
      currentSession: {
        agentId: agentId,
        sessionId: sessionId || '',
        label: label,
        sessionKey: sessionKey,
        spawnDepth: sessionMeta.spawnDepth,
        spawnedBy: sessionMeta.spawnedBy || null,
        sessionRole: sender.role,
        sessionAlias: sender.alias || null,
        model: sender.model || null,
      }
    };
  }

  runtime.normalizeLabel = normalizeLabel;
  runtime.isCanonicalSessionKey = isCanonicalSessionKey;
  runtime.findSessionMetadata = findSessionMetadata;
  runtime.enrichSessionMetadata = enrichSessionMetadata;
})();
