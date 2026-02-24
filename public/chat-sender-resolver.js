(function() {
  'use strict';

  var FALLBACK_SENDER = 'assistant';
  var MAIN_SENDER = 'Ren';

  function safeTrim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function stripWrappingQuotes(value) {
    if (!value) return '';
    var trimmed = safeTrim(value);
    var collapsed = trimmed.replace(/\s+/g, ' ');
    if (trimmed.length >= 2) {
      var first = trimmed[0];
      var last = trimmed[trimmed.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
        return safeTrim(trimmed.slice(1, -1)).replace(/\s+/g, ' ');
      }
    }
    return collapsed;
  }

  function allCapsSegments(segments) {
    for (var i = 0; i < segments.length; i += 1) {
      var segment = segments[i];
      if (!segment) continue;
      if (/[a-z]/.test(segment)) return false;
    }
    return segments.length > 1;
  }

  function sanitizeNoisyLabel(label) {
    var text = stripWrappingQuotes(safeTrim(label));
    if (!text) return '';

    var parts = text.split(':').map(function(part) { return safeTrim(part); }).filter(function(part) { return !!part; });
    if (parts.length <= 1) return text;
    if (/^[A-Z0-9_-]+$/.test(parts[0])) {
      return parts[parts.length - 1];
    }
    if (allCapsSegments(parts)) {
      return parts[parts.length - 1];
    }

    return text;
  }

  function normalizeSpawnDepth(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim()) {
      var parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  function resolveSessionRole(session) {
    var spawnDepth = normalizeSpawnDepth(session && session.spawnDepth);
    var spawnedBy = safeTrim(session && session.spawnedBy);
    if (spawnDepth > 0) return 'subagent';
    if (spawnedBy) return 'subagent';
    if (spawnDepth === 0) return 'main';
    return 'unknown';
  }

  function resolveAlias(session) {
    var alias = sanitizeNoisyLabel(session && (session.normalizedAlias || session.alias));
    if (alias) return alias;

    alias = sanitizeNoisyLabel(session && session.label);
    if (alias) return alias;

    alias = sanitizeNoisyLabel(session && session.sessionId);
    if (alias) return alias;

    if (session && session.sessionKey) {
      alias = sanitizeNoisyLabel(safeTrim(session.sessionKey).split(':').slice(2).join(':'));
      if (alias) return alias;
    }

    return '';
  }

  function resolveChatSenderDisplay(session) {
    var normalizedSession = session || {};
    var role = resolveSessionRole(normalizedSession);
    var alias = resolveAlias(normalizedSession);
    var model = safeTrim(normalizedSession.model);

    if (role === 'main') {
      return {
        displayName: MAIN_SENDER,
        role: role,
        alias: alias || null,
        model: model || null
      };
    }

    return {
      displayName: alias || safeTrim(normalizedSession.agentId) || FALLBACK_SENDER,
      role: role,
      alias: alias || null,
      model: model || null
    };
  }

  window.ChatSenderResolver = {
    FALLBACK_SENDER: FALLBACK_SENDER,
    MAIN_SENDER: MAIN_SENDER,
    sanitizeNoisyLabel: sanitizeNoisyLabel,
    normalizeSpawnDepth: normalizeSpawnDepth,
    resolveChatSenderDisplay: resolveChatSenderDisplay,
    resolveSessionRole: resolveSessionRole,
    resolveAlias: resolveAlias
  };
})();
