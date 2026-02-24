const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME } = require('../lib/helpers');

const DEBOUNCE_MS = 100;
const MAX_SUBSCRIPTIONS_PER_CLIENT = 5;
const CLEANUP_INTERVAL_MS = 60000;
const ID_RE = /^[a-zA-Z0-9_-]+$/;

const logWatchers = new Map(); // filePath -> { watcher, dirWatcher, clients: Set<ws>, offset, debounceTimer, sessionId, agentId }
const clientSubscriptions = new WeakMap(); // ws -> Array<filePath>

function getLogFilePath(agentId, sessionId) {
  return path.join(OPENCLAW_HOME, 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
}

function readNewEntries(entry) {
  const { filePath, sessionId } = entry;
  let stat;
  try { stat = fs.statSync(filePath); } catch { return; }

  if (stat.size < entry.offset) entry.offset = 0;
  if (stat.size === entry.offset) return;

  const bytesToRead = stat.size - entry.offset;
  const buf = Buffer.alloc(bytesToRead);
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, bytesToRead, entry.offset);
  } catch { return; } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  entry.offset = stat.size;

  const lines = buf.toString('utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const msg = JSON.stringify({ type: 'log-entry', sessionId, agentId: entry.agentId, entry: parsed });
    for (const client of entry.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }
}

function startWatcher(filePath, sessionId) {
  const entry = { watcher: null, dirWatcher: null, clients: new Set(), offset: 0, debounceTimer: null, filePath, sessionId };

  const setupFileWatch = () => {
    try { entry.offset = fs.statSync(filePath).size; } catch { entry.offset = 0; }
    try {
      entry.watcher = fs.watch(filePath, () => {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        entry.debounceTimer = setTimeout(() => readNewEntries(entry), DEBOUNCE_MS);
      });
      entry.watcher.on('error', () => {});
    } catch {}
  };

  if (fs.existsSync(filePath)) {
    setupFileWatch();
  } else {
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    try {
      entry.dirWatcher = fs.watch(dir, (eventType, filename) => {
        if (filename === basename && fs.existsSync(filePath)) {
          if (entry.dirWatcher) { entry.dirWatcher.close(); entry.dirWatcher = null; }
          setupFileWatch();
        }
      });
      entry.dirWatcher.on('error', () => {});
    } catch {}
  }

  logWatchers.set(filePath, entry);
  return entry;
}

function removeClientFromWatcher(filePath, client) {
  const entry = logWatchers.get(filePath);
  if (!entry) return;
  entry.clients.delete(client);
  if (entry.clients.size === 0) {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    if (entry.watcher) entry.watcher.close();
    if (entry.dirWatcher) entry.dirWatcher.close();
    logWatchers.delete(filePath);
  }
}

function setupWebSocket(wss, gatewayWS) {
  const { handleChatMessage, isChatMessage, setupChatEventRouting, cleanupChatSubscriptions } = require('./chat-handlers');
  const { handleSessionMessage, isSessionMessage } = require('./session-handlers');

  setupChatEventRouting(gatewayWS);

  wss.on('connection', (ws) => {
    clientSubscriptions.set(ws, []);

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || !msg.type) return;

      if (isChatMessage(msg.type)) {
        try { await handleChatMessage(ws, msg, gatewayWS); } catch(err) { console.error('chat handler error:', err); }
        return;
      }

      if (isSessionMessage(msg.type)) {
        try { await handleSessionMessage(ws, msg); } catch(err) { console.error('session handler error:', err); }
        return;
      }

      if (msg.type === 'subscribe-log') {
        const { agentId, sessionId } = msg;
        if (!agentId || !sessionId || !ID_RE.test(agentId) || !ID_RE.test(sessionId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid agentId or sessionId' }));
          return;
        }
        const filePath = getLogFilePath(agentId, sessionId);
        const subs = clientSubscriptions.get(ws);

        // Auto-unsubscribe previous subscriptions for this client
        const toRemove = subs.filter(fp => fp !== filePath);
        for (const fp of toRemove) {
          removeClientFromWatcher(fp, ws);
        }
        subs.length = 0;

        while (subs.length >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
          const oldest = subs.shift();
          removeClientFromWatcher(oldest, ws);
        }

        if (!subs.includes(filePath)) {
          let entry = logWatchers.get(filePath);
          if (!entry) entry = startWatcher(filePath, sessionId);
          entry.agentId = agentId;
          entry.clients.add(ws);
          subs.push(filePath);
        }

        ws.send(JSON.stringify({ type: 'subscribed', sessionId }));
      } else if (msg.type === 'unsubscribe-log') {
        const { sessionId } = msg;
        if (!sessionId) return;
        const subs = clientSubscriptions.get(ws);
        for (const [filePath, entry] of logWatchers) {
          if (entry.sessionId === sessionId) {
            removeClientFromWatcher(filePath, ws);
            if (subs) {
              const idx = subs.indexOf(filePath);
              if (idx !== -1) subs.splice(idx, 1);
            }
            break;
          }
        }
      }
    });

    ws.on('close', () => {
      const subs = clientSubscriptions.get(ws);
      if (subs) {
        for (const filePath of subs) {
          removeClientFromWatcher(filePath, ws);
        }
      }
      cleanupChatSubscriptions(ws);
    });
  });

  // Periodic cleanup: sweep for leaked watchers with zero subscribers
  setInterval(() => {
    for (const [filePath, entry] of logWatchers) {
      if (entry.clients.size === 0) {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        if (entry.watcher) entry.watcher.close();
        if (entry.dirWatcher) entry.dirWatcher.close();
        logWatchers.delete(filePath);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

module.exports = { setupWebSocket };
