import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

let tmpDir;
let server;
let wss;
let clients = [];
let setupWebSocket;

function createClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    clients.push(ws);
  });
}

function sendJSON(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function waitForMessage(ws, filter, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (!filter || filter(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function collectMessages(ws, durationMs = 500) {
  const msgs = [];
  const handler = (raw) => msgs.push(JSON.parse(raw.toString()));
  ws.on('message', handler);
  return new Promise((resolve) => {
    setTimeout(() => {
      ws.off('message', handler);
      resolve(msgs);
    }, durationMs);
  });
}

function makeSessionDir(agentId) {
  const dir = join(tmpDir, 'agents', agentId, 'sessions');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'hud-ws-test-'));

  // Set env BEFORE requiring modules so destructured OPENCLAW_HOME picks up tmpDir
  process.env.OPENCLAW_HOME = tmpDir;

  // Clear module cache so log-streaming.js re-reads OPENCLAW_HOME
  const modKeys = Object.keys(require.cache).filter(
    (k) => k.includes('log-streaming') || k.includes('helpers')
  );
  for (const k of modKeys) delete require.cache[k];

  const mod = require('../../ws/log-streaming');
  setupWebSocket = mod.setupWebSocket;

  server = http.createServer();
  wss = new WebSocketServer({ server });
  setupWebSocket(wss);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  clients = [];
});

afterEach(async () => {
  delete process.env.OPENCLAW_HOME;
  for (const c of clients) {
    try { c.close(); } catch {}
  }
  await new Promise((r) => {
    if (wss) wss.close(() => r()); else r();
  });
  await new Promise((r) => {
    if (server) server.close(() => r()); else r();
  });
  rmSync(tmpDir, { recursive: true, force: true });
});

function port() {
  return server.address().port;
}

describe('WebSocket log-streaming', () => {
  it('should respond with subscribed on subscribe-log', async () => {
    const ws = await createClient(port());
    const p = waitForMessage(ws, (m) => m.type === 'subscribed');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess1' });
    const msg = await p;
    expect(msg).toEqual({ type: 'subscribed', sessionId: 'sess1' });
  });

  it('should return error for invalid agentId', async () => {
    const ws = await createClient(port());
    const p = waitForMessage(ws, (m) => m.type === 'error');
    sendJSON(ws, { type: 'subscribe-log', agentId: '../bad', sessionId: 'sess1' });
    const msg = await p;
    expect(msg.type).toBe('error');
    expect(msg.message).toContain('Invalid');
  });

  it('should return error for missing sessionId', async () => {
    const ws = await createClient(port());
    const p = waitForMessage(ws, (m) => m.type === 'error');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1' });
    const msg = await p;
    expect(msg.type).toBe('error');
  });

  it('should return error for invalid sessionId', async () => {
    const ws = await createClient(port());
    const p = waitForMessage(ws, (m) => m.type === 'error');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'bad/id' });
    const msg = await p;
    expect(msg.type).toBe('error');
  });

  it('should stream log entries when file exists before subscribe', async () => {
    const dir = makeSessionDir('agent1');
    const logFile = join(dir, 'sess1.jsonl');
    writeFileSync(logFile, '');

    const ws = await createClient(port());
    const subP = waitForMessage(ws, (m) => m.type === 'subscribed');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess1' });
    await subP;

    const entryP = waitForMessage(ws, (m) => m.type === 'log-entry');
    await delay(100);
    appendFileSync(logFile, JSON.stringify({ role: 'user', content: 'hello' }) + '\n');
    const msg = await entryP;
    expect(msg.type).toBe('log-entry');
    expect(msg.sessionId).toBe('sess1');
    expect(msg.agentId).toBe('agent1');
    expect(msg.entry).toEqual({ role: 'user', content: 'hello' });
  });

  it('should stream log entries when file is created after subscribe', async () => {
    const dir = makeSessionDir('agent1');
    const logFile = join(dir, 'sess2.jsonl');

    const ws = await createClient(port());
    const subP = waitForMessage(ws, (m) => m.type === 'subscribed');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess2' });
    await subP;

    await delay(300);

    // Create the file empty first - dir watcher detects it and sets up file watcher
    writeFileSync(logFile, '');
    await delay(500);

    // Now append data - file watcher should fire
    const entryP = waitForMessage(ws, (m) => m.type === 'log-entry');
    appendFileSync(logFile, JSON.stringify({ role: 'assistant', content: 'hi' }) + '\n');
    const msg = await entryP;
    expect(msg.type).toBe('log-entry');
    expect(msg.entry).toEqual({ role: 'assistant', content: 'hi' });
  });

  it('should stop sending entries after unsubscribe', async () => {
    const dir = makeSessionDir('agent1');
    const logFile = join(dir, 'sess1.jsonl');
    writeFileSync(logFile, '');

    const ws = await createClient(port());
    const subP = waitForMessage(ws, (m) => m.type === 'subscribed');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess1' });
    await subP;

    sendJSON(ws, { type: 'unsubscribe-log', sessionId: 'sess1' });
    await delay(200);

    const collected = collectMessages(ws, 500);
    appendFileSync(logFile, JSON.stringify({ role: 'user', content: 'ignored' }) + '\n');
    const msgs = await collected;
    const logEntries = msgs.filter((m) => m.type === 'log-entry');
    expect(logEntries).toHaveLength(0);
  });

  it('should handle client disconnect without errors', async () => {
    const dir = makeSessionDir('agent1');
    const logFile = join(dir, 'sess1.jsonl');
    writeFileSync(logFile, '');

    const ws = await createClient(port());
    const subP = waitForMessage(ws, (m) => m.type === 'subscribed');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess1' });
    await subP;

    ws.close();
    await delay(200);

    appendFileSync(logFile, JSON.stringify({ role: 'user', content: 'after-close' }) + '\n');
    await delay(300);
  });

  it('should send entries to multiple clients subscribed to same session', async () => {
    const dir = makeSessionDir('agent1');
    const logFile = join(dir, 'sess1.jsonl');
    writeFileSync(logFile, '');

    const ws1 = await createClient(port());
    const ws2 = await createClient(port());

    const sub1 = waitForMessage(ws1, (m) => m.type === 'subscribed');
    sendJSON(ws1, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess1' });
    await sub1;

    const sub2 = waitForMessage(ws2, (m) => m.type === 'subscribed');
    sendJSON(ws2, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sess1' });
    await sub2;

    await delay(200);
    const p1 = waitForMessage(ws1, (m) => m.type === 'log-entry');
    const p2 = waitForMessage(ws2, (m) => m.type === 'log-entry');
    appendFileSync(logFile, JSON.stringify({ role: 'user', content: 'broadcast' }) + '\n');

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1.entry.content).toBe('broadcast');
    expect(msg2.entry.content).toBe('broadcast');
  });

  it('should auto-unsubscribe previous session when subscribing to new one', async () => {
    const dirA = makeSessionDir('agent1');
    const fileA = join(dirA, 'sessA.jsonl');
    writeFileSync(fileA, '');

    const dirB = makeSessionDir('agent2');
    const fileB = join(dirB, 'sessB.jsonl');
    writeFileSync(fileB, '');

    const ws = await createClient(port());

    // Subscribe to A
    const subA = waitForMessage(ws, (m) => m.type === 'subscribed' && m.sessionId === 'sessA');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent1', sessionId: 'sessA' });
    await subA;

    // Subscribe to B (should auto-unsub A)
    const subB = waitForMessage(ws, (m) => m.type === 'subscribed' && m.sessionId === 'sessB');
    sendJSON(ws, { type: 'subscribe-log', agentId: 'agent2', sessionId: 'sessB' });
    await subB;

    await delay(300);

    // Verify B works
    const entryP = waitForMessage(ws, (m) => m.type === 'log-entry' && m.entry.content === 'fromB');
    appendFileSync(fileB, JSON.stringify({ role: 'user', content: 'fromB' }) + '\n');
    const msg = await entryP;
    expect(msg.entry.content).toBe('fromB');

    // Verify A doesn't send
    const collected = collectMessages(ws, 500);
    appendFileSync(fileA, JSON.stringify({ role: 'user', content: 'fromA' }) + '\n');
    const msgs = await collected;
    const fromA = msgs.filter((m) => m.type === 'log-entry' && m.entry.content === 'fromA');
    expect(fromA).toHaveLength(0);
  });
});
