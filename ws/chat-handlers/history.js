const path = require('path');
const { OPENCLAW_HOME, safeJSON, safeRead } = require('../../lib/helpers');
const { parseCanonicalSessionKey } = require('./session-key');

const CHAT_HISTORY_LOG_PREFIX = '[CHAT-HISTORY]';

function normalizeHistoryLimit(limit) {
  if (limit === undefined || limit === null || limit === '') return null;
  const parsed = Number(limit);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function logHistory(event, fields = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`);
  }
  console.log(`${CHAT_HISTORY_LOG_PREFIX} ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`);
}

function toMessageContent(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (content === undefined || content === null) return [];
  return [{ type: 'text', text: String(content) }];
}

function mapLocalHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const timestamp = (typeof entry.timestamp === 'string' || typeof entry.timestamp === 'number')
    ? entry.timestamp
    : undefined;

  if (entry.type === 'tool_use') {
    return {
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: entry.id || '',
        name: entry.name || 'tool',
        input: entry.input !== undefined ? entry.input : (entry.content !== undefined ? entry.content : ''),
      }],
      ...(timestamp ? { timestamp } : {}),
    };
  }

  if (entry.type === 'tool_result') {
    return {
      role: 'tool',
      content: [{
        type: 'tool_result',
        tool_use_id: entry.tool_use_id || '',
        content: entry.content !== undefined ? entry.content : '',
      }],
      ...(timestamp ? { timestamp } : {}),
    };
  }

  if (entry.type === 'thinking') {
    return {
      role: 'assistant',
      content: [{
        type: 'thinking',
        thinking: entry.thinking || entry.content || '',
      }],
      ...(timestamp ? { timestamp } : {}),
    };
  }

  const role = typeof entry.role === 'string'
    ? entry.role
    : (entry.message && typeof entry.message.role === 'string' ? entry.message.role : 'system');
  const rawContent = entry.content !== undefined
    ? entry.content
    : (entry.message ? entry.message.content : '');

  return {
    role,
    content: toMessageContent(rawContent),
    ...(timestamp ? { timestamp } : {}),
  };
}

function loadLocalHistory(sessionKey, requestedLimit) {
  const parsed = parseCanonicalSessionKey(sessionKey);
  if (!parsed) throw new Error('Could not parse canonical session key');

  const { agentId, storedKey } = parsed;
  const sessionsDir = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions');
  const sessionsFile = path.join(sessionsDir, 'sessions.json');
  const sessions = safeJSON(sessionsFile);
  if (!sessions || typeof sessions !== 'object') {
    throw new Error('sessions.json not found');
  }

  const canonicalStoredKey = `agent:${agentId}:${storedKey}`;
  const sessionMeta = sessions[storedKey] || sessions[canonicalStoredKey];
  if (!sessionMeta || typeof sessionMeta !== 'object' || typeof sessionMeta.sessionId !== 'string' || !sessionMeta.sessionId) {
    throw new Error('Session not found in sessions.json');
  }

  const raw = safeRead(path.join(sessionsDir, `${sessionMeta.sessionId}.jsonl`));
  if (!raw) throw new Error('Session log not found');

  const limit = normalizeHistoryLimit(requestedLimit);

  if (limit) {
    const messages = [];
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0 && messages.length < limit; i--) {
      const line = lines[i];
      if (!line.trim()) continue;
      let parsedLine;
      try {
        parsedLine = JSON.parse(line);
      } catch {
        continue;
      }
      const mapped = mapLocalHistoryEntry(parsedLine);
      if (mapped) messages.unshift(mapped);
    }
    return messages;
  }

  const messages = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsedLine;
    try {
      parsedLine = JSON.parse(line);
    } catch {
      continue;
    }
    const mapped = mapLocalHistoryEntry(parsedLine);
    if (mapped) messages.push(mapped);
  }

  return messages;
}

function normalizeGatewayError(err) {
  const message = (err && err.message) ? err.message : 'Unknown error';
  const rawCode = (err && typeof err.code === 'string') ? err.code : '';
  if (rawCode === 'INVALID_SESSION_KEY' || rawCode === 'SESSION_NOT_FOUND' || /unknown session|session.*not found|invalid session key/i.test(message)) {
    return { code: 'UNKNOWN_SESSION_KEY', message };
  }
  return { code: rawCode || 'UNKNOWN', message };
}

module.exports = {
  normalizeHistoryLimit,
  logHistory,
  loadLocalHistory,
  normalizeGatewayError,
};
