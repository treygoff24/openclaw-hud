const { getGatewayConfig } = require('../lib/helpers');

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

function isCanonicalSessionKey(sessionKey) {
  return typeof sessionKey === 'string' && CANONICAL_SESSION_KEY_RE.test(sessionKey);
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
      if (!gatewayWS || !gatewayWS.connected) {
        ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey, messages: [], error: { code: 'UNAVAILABLE', message: 'Gateway not connected' } }));
        break;
      }
      try {
        const result = await gatewayWS.request('chat.history', { sessionKey, ...(limit && { limit }) });
        ws.send(JSON.stringify({ 
          type: 'chat-history-result', 
          sessionKey, 
          messages: result.messages || [], 
          thinkingLevel: result.thinkingLevel, 
          verboseLevel: result.verboseLevel 
        }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey, messages: [], error: normalizeGatewayError(err) }));
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
