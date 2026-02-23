const fs = require('fs');
const path = require('path');
const { getGatewayConfig, OPENCLAW_HOME } = require('../lib/helpers');

// Map<sessionKey, Set<WebSocket>> — which browsers want events for which session
const chatSubscriptions = new Map();
// Map<WebSocket, Set<sessionKey>> — reverse lookup for cleanup
const clientChatSubs = new Map();

// Fallback: read chat history directly from local log files
function readLocalChatHistory(sessionKey, limit = 100) {
  // Parse sessionKey format: agent:<agentId>:<sessionId> or agent:<agentId>:subagent:<label>
  const parts = sessionKey.split(':');
  if (parts.length < 3) return null;
  
  const agentId = parts[1];
  // Handle both simple session IDs and complex subagent keys
  const sessionId = parts.slice(2).join(':');
  
  // Find the actual session ID from sessions.json if it's a subagent key
  const sessionsFile = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', 'sessions.json');
  let actualSessionId = sessionId;
  
  try {
    const sessionsData = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    // Find session by key (sessionKey without the 'agent:' prefix)
    const sessionKeyWithoutPrefix = parts.slice(1).join(':');
    if (sessionsData[sessionKey]) {
      actualSessionId = sessionsData[sessionKey].sessionId;
    } else if (sessionsData[sessionKeyWithoutPrefix]) {
      actualSessionId = sessionsData[sessionKeyWithoutPrefix].sessionId;
    }
  } catch (e) {
    // Fall through to use original sessionId
  }
  
  // Read the log file
  const logFile = path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', `${actualSessionId}.jsonl`);
  
  try {
    const data = fs.readFileSync(logFile, 'utf8');
    const lines = data.trim().split('\n').filter(Boolean);
    const entries = [];
    
    for (const line of lines.slice(-limit)) {
      try {
        const entry = JSON.parse(line);
        // Transform log entry to chat message format
        if (entry.type === 'message' || entry.type === 'model_change') {
          entries.push({
            role: entry.role || 'system',
            content: typeof entry.content === 'string' 
              ? [{ type: 'text', text: entry.content }] 
              : entry.content || [{ type: 'text', text: '' }],
            timestamp: entry.timestamp,
            message: entry.message
          });
        } else if (entry.type === 'tool_use') {
          entries.push({
            role: 'assistant',
            content: [{ type: 'tool_use', name: entry.name, input: entry.input || {}, id: entry.id || `tool-${Date.now()}` }],
            timestamp: entry.timestamp
          });
        } else if (entry.type === 'tool_result') {
          entries.push({
            role: 'user',
            content: [{ type: 'tool_result', content: entry.content || '', tool_use_id: entry.tool_use_id || entry.id }],
            timestamp: entry.timestamp
          });
        }
      } catch {}
    }
    
    return { messages: entries, thinkingLevel: 0, verboseLevel: 0 };
  } catch (e) {
    return { messages: [], thinkingLevel: 0, verboseLevel: 0, error: { message: e.message } };
  }
}

async function handleChatMessage(ws, msg, gatewayWS) {
  switch (msg.type) {
    case 'chat-subscribe': {
      const { sessionKey } = msg;
      if (!sessionKey) break;
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
      const { sessionKey, message, idempotencyKey } = msg;
      if (!sessionKey || typeof sessionKey !== 'string') {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'INVALID', message: 'sessionKey required' } }));
        break;
      }
      if (typeof message !== 'string' || !message.trim()) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'INVALID', message: 'message required' } }));
        break;
      }
      if (!gatewayWS || !gatewayWS.connected) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'UNAVAILABLE', message: 'Gateway not connected' } }));
        break;
      }
      try {
        const result = await gatewayWS.request('chat.send', { sessionKey, message, idempotencyKey });
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, runId: result.runId, status: result.status, ok: true }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'chat-send-ack', idempotencyKey, ok: false, error: { code: 'UNKNOWN', message: err.message } }));
      }
      break;
    }
    case 'chat-history': {
      const { sessionKey, limit } = msg;
      try {
        let result;
        // Try gateway first if connected
        if (gatewayWS && gatewayWS.connected) {
          result = await gatewayWS.request('chat.history', { sessionKey, ...(limit && { limit }) });
        } else {
          // Fallback: read from local log files
          result = readLocalChatHistory(sessionKey, limit || 100);
          if (!result) {
            throw new Error('Failed to read local chat history');
          }
        }
        ws.send(JSON.stringify({ 
          type: 'chat-history-result', 
          sessionKey, 
          messages: result.messages || [], 
          thinkingLevel: result.thinkingLevel, 
          verboseLevel: result.verboseLevel 
        }));
      } catch (err) {
        // Final fallback: try local files even if gateway request failed
        const localResult = readLocalChatHistory(sessionKey, limit || 100);
        if (localResult && localResult.messages && localResult.messages.length > 0) {
          ws.send(JSON.stringify({ 
            type: 'chat-history-result', 
            sessionKey, 
            messages: localResult.messages, 
            thinkingLevel: localResult.thinkingLevel, 
            verboseLevel: localResult.verboseLevel 
          }));
        } else {
          ws.send(JSON.stringify({ type: 'chat-history-result', sessionKey, messages: [], error: { code: 'UNKNOWN', message: err.message } }));
        }
      }
      break;
    }
    case 'chat-abort': {
      const { sessionKey, runId } = msg;
      try {
        const result = await gatewayWS.request('chat.abort', { sessionKey, ...(runId && { runId }) });
        ws.send(JSON.stringify({ type: 'chat-abort-result', ok: true, aborted: result.aborted, runIds: result.runIds }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'chat-abort-result', ok: false, error: { code: 'UNKNOWN', message: err.message } }));
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

module.exports = {
  handleChatMessage,
  isChatMessage,
  setupChatEventRouting,
  cleanupChatSubscriptions,
  chatSubscriptions,
  clientChatSubs,
};
