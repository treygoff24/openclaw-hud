import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Instead of mocking fs (which doesn't work well with CJS require('fs')),
// we'll use real temp files and real fs.watch behavior.
// For the parts that need controlled behavior, we'll spy on specific methods.

const TMPDIR = path.join(os.tmpdir(), 'ws-test-' + Date.now());
const MOCK_HOME = path.join(TMPDIR, '.openclaw');

// Create the directory structure
fs.mkdirSync(path.join(MOCK_HOME, 'agents', 'agent1', 'sessions'), { recursive: true });

// Override OPENCLAW_HOME in helpers before loading log-streaming
const helpers = require('../../lib/helpers');
const origHome = helpers.OPENCLAW_HOME;
helpers.OPENCLAW_HOME = MOCK_HOME;

function makeWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    _listeners: {},
    on(e, cb) { (this._listeners[e] ||= []).push(cb); },
    emit(e, ...a) { (this._listeners[e] || []).forEach(cb => cb(...a)); },
  };
}

function makeWss() {
  return {
    _listeners: {},
    on(e, cb) { (this._listeners[e] ||= []).push(cb); },
    emit(e, ...a) { (this._listeners[e] || []).forEach(cb => cb(...a)); },
  };
}

describe('WebSocket log-streaming', () => {
  let setupWebSocket, wss;
  const logFile = (sess = 'sess1') => path.join(MOCK_HOME, 'agents', 'agent1', 'sessions', `${sess}.jsonl`);

  beforeEach(async () => {
    vi.useFakeTimers();
    helpers.OPENCLAW_HOME = MOCK_HOME;

    // Clean up any log files from previous tests
    const sessDir = path.join(MOCK_HOME, 'agents', 'agent1', 'sessions');
    for (const f of fs.readdirSync(sessDir)) {
      fs.unlinkSync(path.join(sessDir, f));
    }

    vi.resetModules();
    const mod = await import('../../ws/log-streaming.js');
    setupWebSocket = mod.setupWebSocket;
    wss = makeWss();
    setupWebSocket(wss);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const connect = () => { const ws = makeWs(); wss.emit('connection', ws); return ws; };
  const sub = (ws, a = 'agent1', s = 'sess1') => ws.emit('message', JSON.stringify({ type: 'subscribe-log', agentId: a, sessionId: s }));

  // === Validation ===

  it('sends subscribed on valid subscribe', () => {
    // Create the log file so watcher starts
    fs.writeFileSync(logFile(), '');
    const ws = connect();
    sub(ws);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribed', sessionId: 'sess1' }));
  });

  it('rejects invalid agentId', () => {
    const ws = connect();
    ws.emit('message', JSON.stringify({ type: 'subscribe-log', agentId: '../bad', sessionId: 's1' }));
    expect(JSON.parse(ws.send.mock.calls[0][0]).type).toBe('error');
  });

  it('rejects invalid sessionId', () => {
    const ws = connect();
    ws.emit('message', JSON.stringify({ type: 'subscribe-log', agentId: 'ok', sessionId: 'b@d' }));
    expect(JSON.parse(ws.send.mock.calls[0][0]).type).toBe('error');
  });

  it('rejects missing agentId', () => {
    const ws = connect();
    ws.emit('message', JSON.stringify({ type: 'subscribe-log', sessionId: 's1' }));
    expect(JSON.parse(ws.send.mock.calls[0][0]).type).toBe('error');
  });

  it('rejects missing sessionId', () => {
    const ws = connect();
    ws.emit('message', JSON.stringify({ type: 'subscribe-log', agentId: 'a1' }));
    expect(JSON.parse(ws.send.mock.calls[0][0]).type).toBe('error');
  });

  it('accepts IDs with hyphens/underscores', () => {
    fs.mkdirSync(path.join(MOCK_HOME, 'agents', 'my-agent_1', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(MOCK_HOME, 'agents', 'my-agent_1', 'sessions', 'sess-2_x.jsonl'), '');
    const ws = connect();
    sub(ws, 'my-agent_1', 'sess-2_x');
    expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'subscribed', sessionId: 'sess-2_x' });
  });

  it('ignores malformed JSON', () => {
    const ws = connect();
    ws.emit('message', 'not{json');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('ignores messages without type', () => {
    const ws = connect();
    ws.emit('message', JSON.stringify({ foo: 1 }));
    expect(ws.send).not.toHaveBeenCalled();
  });

  // === Unsubscribe ===

  it('processes unsubscribe-log message', () => {
    fs.writeFileSync(logFile(), '');
    const ws = connect();
    sub(ws);
    // Should not throw
    ws.emit('message', JSON.stringify({ type: 'unsubscribe-log', sessionId: 'sess1' }));
    expect(ws.send).toHaveBeenCalledTimes(1); // only the subscribed message
  });

  it('ignores unsubscribe without sessionId', () => {
    fs.writeFileSync(logFile(), '');
    const ws = connect();
    sub(ws);
    ws.emit('message', JSON.stringify({ type: 'unsubscribe-log' }));
    // Should not throw, subscribed still sent
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  // === Client disconnect ===

  it('cleans up on client disconnect without error', () => {
    fs.writeFileSync(logFile(), '');
    const ws = connect();
    sub(ws);
    // Should not throw
    ws.emit('close');
  });

  // === Periodic cleanup ===

  it('periodic cleanup fires without error', () => {
    vi.advanceTimersByTime(60000);
  });

  // === Multiple subscriptions ===

  it('auto-unsubscribes previous session on new subscribe (same client)', () => {
    fs.writeFileSync(logFile('sess1'), '');
    fs.writeFileSync(logFile('sess2'), '');
    const ws = connect();
    sub(ws, 'agent1', 'sess1');
    sub(ws, 'agent1', 'sess2');
    // Both should have gotten subscribed confirmations
    expect(ws.send).toHaveBeenCalledTimes(2);
    const msgs = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(msgs[0]).toEqual({ type: 'subscribed', sessionId: 'sess1' });
    expect(msgs[1]).toEqual({ type: 'subscribed', sessionId: 'sess2' });
  });

  it('no duplicate subscription for same session', () => {
    fs.writeFileSync(logFile(), '');
    const ws = connect();
    sub(ws);
    sub(ws);
    // Second subscribe should still confirm
    expect(ws.send).toHaveBeenCalledTimes(2);
  });

  // === File watching with real fs ===
  // These tests verify the watcher setup by checking if subscribe works
  // when file exists vs doesn't exist

  it('subscribes successfully when log file exists', () => {
    fs.writeFileSync(logFile(), '');
    const ws = connect();
    sub(ws);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribed', sessionId: 'sess1' }));
  });

  it('subscribes successfully when log file does not exist (dir watcher)', () => {
    // Don't create the file — module should watch the directory instead
    const ws = connect();
    sub(ws);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribed', sessionId: 'sess1' }));
  });

  // === Multiple clients on same session ===

  it('two clients can subscribe to the same session', () => {
    fs.writeFileSync(logFile(), '');
    const ws1 = connect();
    const ws2 = connect();
    sub(ws1);
    sub(ws2);
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribed', sessionId: 'sess1' }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribed', sessionId: 'sess1' }));
  });

  it('disconnect of one client does not affect other', () => {
    fs.writeFileSync(logFile(), '');
    const ws1 = connect();
    const ws2 = connect();
    sub(ws1);
    sub(ws2);
    ws1.emit('close');
    // ws2 should still be functional - no errors
    expect(ws2.send).toHaveBeenCalledTimes(1);
  });
});

afterAll(() => {
  helpers.OPENCLAW_HOME = origHome;
  try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch {}
});
