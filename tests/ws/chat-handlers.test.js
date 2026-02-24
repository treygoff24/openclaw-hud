import { describe, it, expect, vi, beforeEach } from 'vitest';

let mod;
const MAIN_KEY = 'agent:agent1:main';
const OTHER_KEY = 'agent:agent1:thread-2';
beforeEach(() => {
  // Clear cache to get fresh Maps each time
  const keys = Object.keys(require.cache).filter(k => k.includes('chat-handlers'));
  for (const k of keys) delete require.cache[k];
  mod = require('../../ws/chat-handlers');
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

    it('chat-abort returns result', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ aborted: true, runIds: ['r1'] });
      await mod.handleChatMessage(ws, { type: 'chat-abort', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
      expect(sent.aborted).toBe(true);
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

    it('chat-new calls sessions.reset with provided sessionKey', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ ok: true, key: MAIN_KEY, entry: { sessionId: 'new-uuid' } });
      await mod.handleChatMessage(ws, { type: 'chat-new', sessionKey: MAIN_KEY }, gw);
      expect(gw.request).toHaveBeenCalledWith('sessions.reset', { key: MAIN_KEY, reason: 'new' });
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('chat-new-result');
      expect(sent.ok).toBe(true);
      expect(sent.sessionKey).toBe(MAIN_KEY);
    });

    it('chat-new constructs default key from agentId when sessionKey missing', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockResolvedValue({ ok: true, key: 'agent:codex:main', entry: { sessionId: 'new-uuid' } });
      await mod.handleChatMessage(ws, { type: 'chat-new', agentId: 'codex' }, gw);
      expect(gw.request).toHaveBeenCalledWith('sessions.reset', { key: 'agent:codex:main', reason: 'new' });
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
      expect(sent.sessionKey).toBe('agent:codex:main');
    });

    it('chat-new sends error when gateway disconnected', async () => {
      const ws = mockWs();
      const gw = mockGateway(false);
      await mod.handleChatMessage(ws, { type: 'chat-new', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('chat-new-result');
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('UNAVAILABLE');
    });

    it('chat-new sends error when sessions.reset throws', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      gw.request.mockRejectedValue(new Error('reset failed'));
      await mod.handleChatMessage(ws, { type: 'chat-new', sessionKey: MAIN_KEY }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('chat-new-result');
      expect(sent.ok).toBe(false);
      expect(sent.error).toBeDefined();
    });

    it('chat-new sends error when no sessionKey and no agentId', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      await mod.handleChatMessage(ws, { type: 'chat-new' }, gw);
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('chat-new-result');
      expect(sent.ok).toBe(false);
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
