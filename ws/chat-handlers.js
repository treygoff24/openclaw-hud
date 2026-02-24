const path = require('path');
const { OPENCLAW_HOME, getGatewayConfig, safeJSON, safeRead } = require('../lib/helpers');

// Map<sessionKey, Set<WebSocket>> — which browsers want events for which session
const chatSubscriptions = new Map();

// Attachment rate limiting — per WebSocket connection
const connectionAttachmentTimestamps = new WeakMap();
const MAX_ATTACHMENTS_PER_MINUTE = 5;
const RATE_LIMIT_WINDOW_MS = 60000;
// Map<WebSocket, Set<sessionKey>> — reverse lookup for cleanup
const clientChatSubs = new Map();

// Attachment rate limiting — per WebSocket connection
function checkAttachmentRateLimit(ws) {
  const now = Date.now();
  
  // Get existing timestamps for this connection
  let timestamps = connectionAttachmentTimestamps.get(ws);
  if (!timestamps) {
    timestamps = [];
    connectionAttachmentTimestamps.set(ws, timestamps);
  }
  
  // Remove timestamps outside the window
  while (timestamps.length && timestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    timestamps.shift();
  }
  
  // Check if limit exceeded
  if (timestamps.length >= MAX_ATTACHMENTS_PER_MINUTE) {
    return { allowed: false, error: { code: 'RATE_LIMITED', message: 'Too many attachment uploads' } };
  }
  
  // Add current timestamp
  timestamps.push(now);
  return { allowed: true };
}

const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;
const CHAT_HISTORY_LOG_PREFIX = '[CHAT-HISTORY]';

function isCanonicalSessionKey(sessionKey) {
  return typeof sessionKey === 'string' && CANONICAL_SESSION_KEY_RE.test(sessionKey);
}

function parseCanonicalSessionKey(sessionKey) {
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  return {
    agentId: parts[1],
    storedKey: parts.slice(2).join(':')
  };
}

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
        input: entry.input !== undefined ? entry.input : (entry.content !== undefined ? entry.content : '')
      }],
      ...(timestamp ? { timestamp } : {})
    };
  }

  if (entry.type === 'tool_result') {
    return {
      role: 'tool',
      content: [{
        type: 'tool_result',
        tool_use_id: entry.tool_use_id || '',
        content: entry.content !== undefined ? entry.content : ''
      }],
      ...(timestamp ? { timestamp } : {})
    };
  }

  if (entry.type === 'thinking') {
    return {
      role: 'assistant',
      content: [{
        type: 'thinking',
        thinking: entry.thinking || entry.content || ''
      }],
      ...(timestamp ? { timestamp } : {})
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
    ...(timestamp ? { timestamp } : {})
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

  // For limit queries, parse from the tail and stop as soon as enough messages are mapped.
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

async function handleChatMessage(ws, msg, gatewayWS) {
  switch (msg.type) {
    case 'chat-subscribe': {
      const { sessionKey } = msg;
      if (!isCanonicalSessionKey(sessionKey)) {
        ws.send(JSON.stringify({ type: 'error', error: { code: 'INVALID_SESSION_KEY', message: 'canonical sessionKey required' } }));
        break;
      }
      if (!chatSubscriptions.has(sessionKey)) chatSubscriptions.set(sessionKey, new Set());
      chatSubscriptions.get(sessionKey).add(ws);
      if (!clientChatSubs.has(ws)) clientChatSubs.set(ws, new Set());
      clientChatSubs.get(ws).add(sessionKey);
      ws.send(JSON.stringify({ type: 'chat-subscribe-ack', sessionKey }));
      break;
    }
    case 'chat-unsubscribe': {
      const { sessionKey } = msg;
      chatSubscriptions.get(sessionKey)?.delete(ws);
      clientChatSubs.get(ws)?.delete(sessionKey);
      break;
    }
    case 'chat-send': {
      const { sessionKey, message, idempotencyKey, attachments } = msg;
      if (!isCanonicalSessionKey(sessionKey)) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'INVALID_SESSION_KEY', message: 'canonical sessionKey required' } }));
        break;
      }
      // Allow either message or attachments (but at least one required)
      if (typeof message !== 'string' && (!attachments || !Array.isArray(attachments) || attachments.length === 0)) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'INVALID', message: 'message or attachments required' } }));
        break;
      }
      // Validate attachments if present
      if (attachments && Array.isArray(attachments)) {
        const validationError = validateAttachments(attachments);
        if (validationError) {
          ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: validationError }));
          break;
        }
        // Check attachment rate limit
        const rateLimitResult = checkAttachmentRateLimit(ws);
        if (!rateLimitResult.allowed) {
          ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: rateLimitResult.error }));
          break;
        }
      }
      if (!gatewayWS || !gatewayWS.connected) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'UNAVAILABLE', message: 'Gateway not connected' } }));
        break;
      }
      try {
        // Build content blocks
        const content = buildContentBlocks(message, attachments);
        const result = await gatewayWS.request('chat.send', { sessionKey, content, idempotencyKey });
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, runId: result.runId, status: result.status, ok: true }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: normalizeGatewayError(err) }));
      }
      break;
    }
    case 'chat-history': {
      const { sessionKey, limit } = msg;
      if (!isCanonicalSessionKey(sessionKey)) {
        ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey: sessionKey || '', messages: [], error: { code: 'INVALID_SESSION_KEY', message: 'canonical sessionKey required' } }));
        break;
      }
      const normalizedLimit = normalizeHistoryLimit(limit);
      logHistory('request', { sessionKey, limit: normalizedLimit || 'default' });

      let gatewayError = null;
      let shouldFallback = false;
      if (gatewayWS && gatewayWS.connected) {
        logHistory('gateway-attempt', { sessionKey });
        try {
          const result = await gatewayWS.request('chat.history', { sessionKey, ...(normalizedLimit ? { limit: normalizedLimit } : {}) });
          const messages = result.messages || [];
          ws.send(JSON.stringify({
            type: 'chat-history-result',
            sessionKey,
            messages,
            thinkingLevel: result.thinkingLevel,
            verboseLevel: result.verboseLevel
          }));
          logHistory('gateway-success', { sessionKey, count: messages.length });
          break;
        } catch (err) {
          gatewayError = normalizeGatewayError(err);
          logHistory('gateway-fail', { sessionKey, code: gatewayError.code });
          shouldFallback = gatewayError.code === 'UNKNOWN_SESSION_KEY';
        }
      } else {
        gatewayError = { code: 'UNAVAILABLE', message: 'Gateway not connected' };
        logHistory('gateway-unavailable', { sessionKey });
        shouldFallback = true;
      }

      if (!shouldFallback) {
        ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey, messages: [], error: gatewayError }));
        logHistory('fallback-skipped', { sessionKey, code: gatewayError?.code || 'UNKNOWN' });
        break;
      }

      try {
        const fallbackMessages = loadLocalHistory(sessionKey, normalizedLimit);
        ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey, messages: fallbackMessages }));
        logHistory('fallback-success', { sessionKey, count: fallbackMessages.length });
      } catch (fallbackErr) {
        const errorToSend = gatewayError || { code: 'UNAVAILABLE', message: 'History unavailable' };
        ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey, messages: [], error: errorToSend }));
        logHistory('fallback-fail', { sessionKey, reason: fallbackErr.message });
      }
      break;
    }
    case 'chat-abort': {
      const { sessionKey, runId } = msg;
      if (!isCanonicalSessionKey(sessionKey)) {
        ws.send(JSON.stringify({ type: 'chat-abort-result', ok: false, error: { code: 'INVALID_SESSION_KEY', message: 'canonical sessionKey required' } }));
        break;
      }
      if (!gatewayWS || !gatewayWS.connected) {
        ws.send(JSON.stringify({ type: 'chat-abort-result', ok: false, error: { code: 'UNAVAILABLE', message: 'Gateway not connected' } }));
        break;
      }
      try {
        const result = await gatewayWS.request('chat.abort', { sessionKey, ...(runId && { runId }) });
        ws.send(JSON.stringify({ type: 'chat-abort-result', ok: true, aborted: result.aborted, runIds: result.runIds }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'chat-abort-result', ok: false, error: normalizeGatewayError(err) }));
      }
      break;
    }
    case 'chat-new': {
      const { model, agentId } = msg;
      const gwConfig = getGatewayConfig();
      if (!gwConfig.token) {
        ws.send(JSON.stringify({ type: 'chat-new-result', ok: false, error: 'Gateway token not configured' }));
        break;
      }
      try {
        const gwRes = await fetch(`http://127.0.0.1:${gwConfig.port}/tools/invoke`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${gwConfig.token}` },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            tool: 'sessions_spawn',
            args: { task: 'New chat session from HUD', agentId: agentId || undefined, model: model || undefined, mode: 'session', label: `hud-${Date.now()}` }
          })
        });
        const body = await gwRes.json();
        const sessionKey = body?.result?.details?.childSessionKey;
        if (sessionKey) {
          ws.send(JSON.stringify({ type: 'chat-new-result', ok: true, sessionKey }));
        } else {
          ws.send(JSON.stringify({ type: 'chat-new-result', ok: false, error: body?.error?.message || 'Unknown error' }));
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'chat-new-result', ok: false, error: err.message }));
      }
      break;
    }
    case 'models-list': {
      try {
        const result = await gatewayWS.request('models.list', {});
        ws.send(JSON.stringify({ type: 'models-list-result', models: result.models || result }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'models-list-result', models: [], error: err.message }));
      }
      break;
    }
    default:
      return false; // not handled
  }
  return true;
}

function isChatMessage(type) {
  return ['chat-subscribe', 'chat-unsubscribe', 'chat-send', 'chat-history', 'chat-abort', 'chat-new', 'models-list'].includes(type);
}

function setupChatEventRouting(gatewayWS) {
  if (!gatewayWS) return;
  gatewayWS.on('chat-event', (payload) => {
    const { sessionKey } = payload;
    const clients = chatSubscriptions.get(sessionKey);
    if (!clients) return;
    const msg = JSON.stringify({ type: 'chat-event', payload });
    for (const client of clients) {
      if (client.readyState === 1) client.send(msg);
    }
  });
}

function cleanupChatSubscriptions(ws) {
  const chatSubs = clientChatSubs.get(ws);
  if (chatSubs) {
    for (const key of chatSubs) {
      chatSubscriptions.get(key)?.delete(ws);
    }
    clientChatSubs.delete(ws);
  }
}

// Attachment helpers
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB server-side limit
const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function validateAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return { code: 'INVALID', message: 'attachments must be an array' };
  }
  
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    
    // Must be image type
    if (att.type !== 'image') {
      return { code: 'INVALID_ATTACHMENT_TYPE', message: 'only image attachments are supported, got: ' + att.type };
    }
    
    if (!att.source || !att.source.type) {
      return { code: 'INVALID', message: 'attachment missing source' };
    }

    // Validate media_type - must be in allowlist
    if (!att.source.media_type) {
      return { code: 'INVALID_MEDIA_TYPE', message: 'attachment missing media_type' };
    }
    if (!ALLOWED_MEDIA_TYPES.includes(att.source.media_type)) {
      return { code: 'INVALID_MEDIA_TYPE', message: 'media_type not allowed: ' + att.source.media_type };
    }
    
    // For base64, check size
    if (att.source.type === 'base64') {
      if (!att.source.data) {
        return { code: 'INVALID', message: 'attachment missing data' };
      }
      // Approximate size: base64 is ~1.33x the original size
      const approxSize = Math.ceil(att.source.data.length * 0.75);
      if (approxSize > MAX_ATTACHMENT_SIZE) {
        return { code: 'ATTACHMENT_TOO_LARGE', message: 'attachment exceeds 10MB limit' };
      }
    }
  }
  
  return null; // valid
}

function buildContentBlocks(message, attachments) {
  const content = [];
  
  // Add text message as content block
  if (message && message.trim()) {
    content.push({ type: 'text', text: message });
  }
  
  // Add attachments as image content blocks
  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      content.push({
        type: 'image',
        source: {
          type: att.source.type,
          media_type: att.source.media_type,
          data: att.source.data,
          url: att.source.url
        }
      });
    }
  }
  
  return content;
}

module.exports = {
  handleChatMessage,
  isChatMessage,
  setupChatEventRouting,
  cleanupChatSubscriptions,
  chatSubscriptions,
  clientChatSubs,
  // Rate limiting exports for testing
  checkAttachmentRateLimit,
  MAX_ATTACHMENTS_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  connectionAttachmentTimestamps,
};
