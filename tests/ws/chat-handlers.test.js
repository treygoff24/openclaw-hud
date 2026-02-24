import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mod;
const MAIN_KEY = 'agent:agent1:main';
const OTHER_KEY = 'agent:agent1:thread-2';
let tmpOpenclawHome;

function resetModules() {
  const keys = Object.keys(require.cache).filter(
    (k) => k.includes('chat-handlers') || k.includes(`${path.sep}lib${path.sep}helpers`)
  );
  for (const k of keys) delete require.cache[k];
}

function loadModuleWithHome(openclawHome) {
  process.env.OPENCLAW_HOME = openclawHome;
  resetModules();
  mod = require('../../ws/chat-handlers');
}

function writeLocalHistoryFixture({ sessionKey, sessionId, lines, storeCanonicalKey = false }) {
  const parts = sessionKey.split(':');
  const agentId = parts[1];
  const storedKey = parts.slice(2).join(':');
  const sessionsDir = path.join(tmpOpenclawHome, 'agents', agentId, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const key = storeCanonicalKey ? sessionKey : storedKey;
  fs.writeFileSync(path.join(sessionsDir, 'sessions.json'), JSON.stringify({ [key]: { sessionId } }, null, 2));
  fs.writeFileSync(path.join(sessionsDir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
}

beforeEach(() => {
  tmpOpenclawHome = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-handlers-'));
  loadModuleWithHome(tmpOpenclawHome);
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.OPENCLAW_HOME;
  if (tmpOpenclawHome) {
    fs.rmSync(tmpOpenclawHome, { recursive: true, force: true });
  }
});

function mockWs(readyState = 1) {
  return { readyState, send: vi.fn() };
}

function mockGateway(connected = true) {
  return { connected, on: vi.fn(), request: vi.fn() };
}

describe('chat-handlers', () => {
  describe('handleChatMessage', () => {
    it('chat-subscribe adds to maps and sends ack', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-subscribe', sessionKey: MAIN_KEY }, null);
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'chat-subscribe-ack', sessionKey: MAIN_KEY }));
      expect(mod.chatSubscriptions.get(MAIN_KEY).has(ws)).toBe(true);
      expect(mod.clientChatSubs.get(ws).has(MAIN_KEY)).toBe(true);
    });

    it('chat-subscribe without sessionKey sends explicit error', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-subscribe' }, null);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('error');
      expect(sent.error.code).toBe('INVALID_SESSION_KEY');
    });

    it('chat-subscribe with non-canonical sessionKey sends explicit error', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-subscribe', sessionKey: 'sk1' }, null);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('error');
      expect(sent.error.code).toBe('INVALID_SESSION_KEY');
    });

    it('chat-unsubscribe removes from maps', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-subscribe', sessionKey: MAIN_KEY }, null);
      await mod.handleChatMessage(ws, { type: 'chat-unsubscribe', sessionKey: MAIN_KEY }, null);
      expect(mod.chatSubscriptions.get(MAIN_KEY).has(ws)).toBe(false);
    });

    it('chat-send with connected gateway sends ok ack', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ runId: 'r1', status: 'queued' });
      await mod.handleChatMessage(ws, { type: 'chat-send', sessionKey: MAIN_KEY, message: 'hi', idempotencyKey: 'ik1' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
      expect(sent.runId).toBe('r1');
    });

    it('chat-send with disconnected gateway sends error', async () => {
      const ws = mockWs();
      const gw = mockGateway(false);
      await mod.handleChatMessage(ws, { type: 'chat-send', sessionKey: MAIN_KEY, message: 'hi', idempotencyKey: 'ik1' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('UNAVAILABLE');
    });

    it('chat-send with null gateway sends error', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-send', sessionKey: MAIN_KEY, message: 'hi', idempotencyKey: 'ik1' }, null);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
    });

    it('chat-send with request error sends error ack', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockRejectedValue(new Error('boom'));
      await mod.handleChatMessage(ws, { type: 'chat-send', sessionKey: MAIN_KEY, message: 'hi', idempotencyKey: 'ik1' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.message).toBe('boom');
    });

    it('chat-history returns messages', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ messages: [{ role: 'user', content: 'hi' }] });
      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.messages).toHaveLength(1);
    });

    it('chat-history error returns empty messages', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockRejectedValue(new Error('fail'));
      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.messages).toEqual([]);
      expect(sent.error.message).toBe('fail');
    });

    it('chat-history with disconnected gateway returns explicit unavailable error', async () => {
      const ws = mockWs();
      const gw = mockGateway(false);
      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.messages).toEqual([]);
      expect(sent.error.code).toBe('UNAVAILABLE');
    });

    it('chat-history maps unknown session errors explicitly', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      const err = new Error('Session not found');
      err.code = 'SESSION_NOT_FOUND';
      gw.request.mockRejectedValue(err);
      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.error.code).toBe('UNKNOWN_SESSION_KEY');
    });

    it('chat-history with disconnected gateway falls back to local history', async () => {
      writeLocalHistoryFixture({
        sessionKey: MAIN_KEY,
        sessionId: 'sess-local-1',
        lines: [
          JSON.stringify({ type: 'message', role: 'user', content: 'hello from local', timestamp: '2026-02-24T10:00:00.000Z' }),
          JSON.stringify({ type: 'message', role: 'assistant', content: 'loaded from disk', timestamp: '2026-02-24T10:00:01.000Z' })
        ]
      });
      const ws = mockWs();
      const gw = mockGateway(false);

      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY, limit: 1 }, gw);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.error).toBeUndefined();
      expect(sent.messages).toHaveLength(1);
      expect(sent.messages[0].role).toBe('assistant');
      expect(sent.messages[0].content[0].text).toBe('loaded from disk');
    });

    it('chat-history falls back when gateway returns unknown session', async () => {
      writeLocalHistoryFixture({
        sessionKey: MAIN_KEY,
        sessionId: 'sess-local-2',
        lines: [
          JSON.stringify({ type: 'message', role: 'user', content: 'local user prompt' }),
          JSON.stringify({ type: 'message', role: 'assistant', content: 'local assistant reply' })
        ]
      });
      const ws = mockWs();
      const gw = mockGateway(true);
      const err = new Error('Session not found');
      err.code = 'SESSION_NOT_FOUND';
      gw.request.mockRejectedValue(err);

      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY }, gw);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(gw.request).toHaveBeenCalledWith('chat.history', { sessionKey: MAIN_KEY });
      expect(sent.error).toBeUndefined();
      expect(sent.messages).toHaveLength(2);
      expect(sent.messages[1].content[0].text).toBe('local assistant reply');
    });

    it('chat-history does not mask non-recoverable gateway errors with local fallback', async () => {
      writeLocalHistoryFixture({
        sessionKey: MAIN_KEY,
        sessionId: 'sess-local-nonrecoverable',
        lines: [
          JSON.stringify({ type: 'message', role: 'assistant', content: 'should not be returned' })
        ]
      });
      const ws = mockWs();
      const gw = mockGateway(true);
      const err = new Error('Gateway auth failed');
      err.code = 'AUTH_FAILED';
      gw.request.mockRejectedValue(err);

      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY }, gw);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.messages).toEqual([]);
      expect(sent.error.code).toBe('AUTH_FAILED');
      expect(sent.error.message).toBe('Gateway auth failed');
    });

    it('chat-history local fallback with limit parses from tail', async () => {
      writeLocalHistoryFixture({
        sessionKey: MAIN_KEY,
        sessionId: 'sess-local-tail-limit',
        lines: [
          JSON.stringify({ type: 'message', role: 'user', content: 'oldest' }),
          JSON.stringify({ type: 'message', role: 'assistant', content: 'older' }),
          JSON.stringify({ type: 'message', role: 'assistant', content: 'newer' }),
          JSON.stringify({ type: 'message', role: 'assistant', content: 'newest' })
        ]
      });
      const ws = mockWs();
      const gw = mockGateway(false);
      const originalParse = JSON.parse;
      const parseSpy = vi.spyOn(JSON, 'parse');
      let parseCallCount = 0;

      try {
        await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: MAIN_KEY, limit: 1 }, gw);
      } finally {
        parseCallCount = parseSpy.mock.calls.length;
        parseSpy.mockRestore();
      }

      const sent = originalParse(ws.send.mock.calls[0][0]);
      expect(sent.error).toBeUndefined();
      expect(sent.messages).toHaveLength(1);
      expect(sent.messages[0].content[0].text).toBe('newest');
      expect(parseCallCount).toBeLessThanOrEqual(3);
    });

    it('chat-history resolves canonical session keys containing extra colons', async () => {
      const deepKey = 'agent:agent1:thread:child:leaf';
      writeLocalHistoryFixture({
        sessionKey: deepKey,
        sessionId: 'sess-colon-key',
        lines: [JSON.stringify({ type: 'message', role: 'assistant', content: 'colon key works' })]
      });
      const ws = mockWs();
      const gw = mockGateway(false);

      await mod.handleChatMessage(ws, { type: 'chat-history', sessionKey: deepKey }, gw);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.error).toBeUndefined();
      expect(sent.messages).toHaveLength(1);
      expect(sent.messages[0].content[0].text).toBe('colon key works');
    });

    it('chat-abort returns result', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ aborted: true, runIds: ['r1'] });
      await mod.handleChatMessage(ws, { type: 'chat-abort', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
      expect(sent.aborted).toBe(true);
    });

    it('chat-abort with invalid session key returns explicit error', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      await mod.handleChatMessage(ws, { type: 'chat-abort', sessionKey: 'invalid-key' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('INVALID_SESSION_KEY');
    });

    it('chat-abort with unavailable gateway returns explicit error', async () => {
      const ws = mockWs();
      const gw = mockGateway(false);
      await mod.handleChatMessage(ws, { type: 'chat-abort', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('UNAVAILABLE');
    });

    it('chat-abort normalizes unknown session errors', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      const err = new Error('Unknown session key');
      err.code = 'SESSION_NOT_FOUND';
      gw.request.mockRejectedValue(err);

      await mod.handleChatMessage(ws, { type: 'chat-abort', sessionKey: MAIN_KEY }, gw);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('UNKNOWN_SESSION_KEY');
      expect(sent.error.message).toBe('Unknown session key');
    });

    it('chat-abort includes runId when provided', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ aborted: true, runIds: ['r1'] });

      await mod.handleChatMessage(ws, { type: 'chat-abort', sessionKey: MAIN_KEY, runId: 'r1' }, gw);

      expect(gw.request).toHaveBeenCalledWith('chat.abort', { sessionKey: MAIN_KEY, runId: 'r1' });
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
    });

    it('chat-new returns token error when gateway token is missing', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-new' }, null);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'chat-new-result', ok: false, error: 'Gateway token not configured' });
    });

    it('chat-new success returns spawned session key', async () => {
      const ws = mockWs();
      fs.writeFileSync(path.join(tmpOpenclawHome, 'openclaw.json'), JSON.stringify({
        gateway: { port: 19999, auth: { token: 'test-token' } }
      }));
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ result: { details: { childSessionKey: MAIN_KEY } } })
      });
      vi.stubGlobal('fetch', fetchMock);

      await mod.handleChatMessage(ws, { type: 'chat-new', model: 'gpt-5', agentId: 'agent1' }, null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:19999/tools/invoke');
      expect(options.headers.Authorization).toBe('Bearer test-token');
      const parsedBody = JSON.parse(options.body);
      expect(parsedBody.tool).toBe('sessions_spawn');
      expect(parsedBody.args.agentId).toBe('agent1');
      expect(parsedBody.args.model).toBe('gpt-5');
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'chat-new-result', ok: true, sessionKey: MAIN_KEY });

      vi.unstubAllGlobals();
    });

    it('chat-new returns gateway body error when spawn response has no session key', async () => {
      const ws = mockWs();
      fs.writeFileSync(path.join(tmpOpenclawHome, 'openclaw.json'), JSON.stringify({
        gateway: { auth: { token: 'test-token' } }
      }));
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ error: { message: 'spawn denied' } })
      });
      vi.stubGlobal('fetch', fetchMock);

      await mod.handleChatMessage(ws, { type: 'chat-new' }, null);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'chat-new-result', ok: false, error: 'spawn denied' });
      vi.unstubAllGlobals();
    });

    it('chat-new returns thrown fetch error message', async () => {
      const ws = mockWs();
      fs.writeFileSync(path.join(tmpOpenclawHome, 'openclaw.json'), JSON.stringify({
        gateway: { auth: { token: 'test-token' } }
      }));
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', fetchMock);

      await mod.handleChatMessage(ws, { type: 'chat-new' }, null);

      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent).toEqual({ type: 'chat-new-result', ok: false, error: 'network down' });
      vi.unstubAllGlobals();
    });

    it('models-list returns models', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ models: ['gpt-4'] });
      await mod.handleChatMessage(ws, { type: 'models-list' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.models).toEqual(['gpt-4']);
    });

    it('chat-send without sessionKey sends error', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      await mod.handleChatMessage(ws, { type: 'chat-send', message: 'hi', idempotencyKey: 'ik1' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('INVALID_SESSION_KEY');
    });

    it('chat-send without message sends error', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      await mod.handleChatMessage(ws, { type: 'chat-send', sessionKey: MAIN_KEY, message: '', idempotencyKey: 'ik1' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
    });

    it('unknown type returns false', async () => {
      const ws = mockWs();
      const result = await mod.handleChatMessage(ws, { type: 'unknown' }, null);
      expect(result).toBe(false);
    });
  });

  describe('isChatMessage', () => {
    it('returns true for chat types', () => {
      expect(mod.isChatMessage('chat-subscribe')).toBe(true);
      expect(mod.isChatMessage('chat-send')).toBe(true);
      expect(mod.isChatMessage('models-list')).toBe(true);
    });
    it('returns false for non-chat types', () => {
      expect(mod.isChatMessage('subscribe-log')).toBe(false);
    });
  });

  describe('setupChatEventRouting', () => {
    it('registers chat-event listener on gateway', () => {
      const gw = mockGateway();
      mod.setupChatEventRouting(gw);
      expect(gw.on).toHaveBeenCalledWith('chat-event', expect.any(Function));
    });

    it('does nothing with null gateway', () => {
      mod.setupChatEventRouting(null); // should not throw
    });

    it('fans out chat-event to all subscribed ready clients only', async () => {
      const wsReady1 = mockWs(1);
      const wsReady2 = mockWs(1);
      const wsClosed = mockWs(3);
      const wsOtherSession = mockWs(1);
      const gw = mockGateway();

      await mod.handleChatMessage(wsReady1, { type: 'chat-subscribe', sessionKey: MAIN_KEY }, null);
      await mod.handleChatMessage(wsReady2, { type: 'chat-subscribe', sessionKey: MAIN_KEY }, null);
      await mod.handleChatMessage(wsClosed, { type: 'chat-subscribe', sessionKey: MAIN_KEY }, null);
      await mod.handleChatMessage(wsOtherSession, { type: 'chat-subscribe', sessionKey: OTHER_KEY }, null);

      mod.setupChatEventRouting(gw);
      const handler = gw.on.mock.calls.find(([event]) => event === 'chat-event')[1];
      const payload = { sessionKey: MAIN_KEY, seq: 7, state: 'delta' };

      handler(payload);

      const expected = JSON.stringify({ type: 'chat-event', payload });
      expect(wsReady1.send).toHaveBeenCalledWith(expected);
      expect(wsReady2.send).toHaveBeenCalledWith(expected);
      expect(wsClosed.send).not.toHaveBeenCalledWith(expected);
      expect(wsOtherSession.send).not.toHaveBeenCalledWith(expected);
    });
  });

  describe('cleanupChatSubscriptions', () => {
    it('removes ws from all subscriptions', async () => {
      const ws = mockWs();
      await mod.handleChatMessage(ws, { type: 'chat-subscribe', sessionKey: MAIN_KEY }, null);
      await mod.handleChatMessage(ws, { type: 'chat-subscribe', sessionKey: OTHER_KEY }, null);
      mod.cleanupChatSubscriptions(ws);
      expect(mod.chatSubscriptions.get(MAIN_KEY).has(ws)).toBe(false);
      expect(mod.chatSubscriptions.get(OTHER_KEY).has(ws)).toBe(false);
      expect(mod.clientChatSubs.has(ws)).toBe(false);
    });
  });
});
