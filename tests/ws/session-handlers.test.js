import { describe, it, expect, vi, beforeEach } from 'vitest';

let mod;
const MAIN_KEY = 'agent:agent1:main';
const OTHER_KEY = 'agent:agent1:thread-2';

beforeEach(() => {
  // Clear cache to get fresh module each time
  const keys = Object.keys(require.cache).filter(k => k.includes('session-handlers'));
  for (const k of keys) delete require.cache[k];
  mod = require('../../ws/session-handlers');
  vi.clearAllMocks();
});

function mockWs(readyState = 1) {
  return { readyState, send: vi.fn() };
}

describe('session-handlers', () => {
  describe('handleSessionMessage', () => {
    it('returns false for unhandled message types', async () => {
      const ws = mockWs();
      const result = await mod.handleSessionMessage(ws, { type: 'unknown' });
      expect(result).toBe(false);
    });

    describe('sessions.patch', () => {
      it('returns error for missing sessionKey', async () => {
        const ws = mockWs();
        await mod.handleSessionMessage(ws, { type: 'sessions.patch', model: 'gpt-4' });
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('error');
        expect(sent.error.code).toBe('INVALID_SESSION_KEY');
      });

      it('returns error for invalid sessionKey format', async () => {
        const ws = mockWs();
        await mod.handleSessionMessage(ws, { type: 'sessions.patch', sessionKey: 'invalid-key', model: 'gpt-4' });
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('error');
        expect(sent.error.code).toBe('INVALID_SESSION_KEY');
      });

      it('returns error when no updates provided', async () => {
        const ws = mockWs();
        await mod.handleSessionMessage(ws, { type: 'sessions.patch', sessionKey: MAIN_KEY });
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('error');
        expect(sent.error.code).toBe('NO_UPDATES');
      });

      it('returns error for invalid thinking value', async () => {
        const ws = mockWs();
        await mod.handleSessionMessage(ws, { 
          type: 'sessions.patch', 
          sessionKey: MAIN_KEY, 
          thinking: 'invalid-value' 
        });
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('error');
        expect(sent.error.code).toBe('INVALID_THINKING');
      });

      it('returns error for non-boolean verbose value', async () => {
        const ws = mockWs();
        await mod.handleSessionMessage(ws, { 
          type: 'sessions.patch', 
          sessionKey: MAIN_KEY, 
          verbose: 'yes' 
        });
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('error');
        expect(sent.error.code).toBe('INVALID_VERBOSE');
      });
    });
  });

  describe('isSessionMessage', () => {
    it('returns true for sessions.patch', () => {
      expect(mod.isSessionMessage('sessions.patch')).toBe(true);
    });

    it('returns false for non-session types', () => {
      expect(mod.isSessionMessage('chat-send')).toBe(false);
      expect(mod.isSessionMessage('subscribe-log')).toBe(false);
      expect(mod.isSessionMessage('unknown')).toBe(false);
    });
  });

  describe('validateUpdates', () => {
    it('rejects when no updates provided', () => {
      const result = mod.validateUpdates({});
      expect(result.valid).toBe(false);
      expect(result.error.code).toBe('NO_UPDATES');
    });

    it('accepts model update', () => {
      const result = mod.validateUpdates({ model: 'gpt-4' });
      expect(result.valid).toBe(true);
    });

    it('accepts thinking update with valid value', () => {
      const result = mod.validateUpdates({ thinking: 'on' });
      expect(result.valid).toBe(true);
    });

    it('accepts thinking update with off value', () => {
      const result = mod.validateUpdates({ thinking: 'off' });
      expect(result.valid).toBe(true);
    });

    it('accepts thinking update with extended value', () => {
      const result = mod.validateUpdates({ thinking: 'extended' });
      expect(result.valid).toBe(true);
    });

    it('accepts verbose update with boolean value', () => {
      const result = mod.validateUpdates({ verbose: true });
      expect(result.valid).toBe(true);
    });

    it('accepts verbose update with false value', () => {
      const result = mod.validateUpdates({ verbose: false });
      expect(result.valid).toBe(true);
    });

    it('rejects invalid thinking value', () => {
      const result = mod.validateUpdates({ thinking: 'medium' });
      expect(result.valid).toBe(false);
      expect(result.error.code).toBe('INVALID_THINKING');
    });

    it('rejects non-boolean verbose value', () => {
      const result = mod.validateUpdates({ verbose: 'yes' });
      expect(result.valid).toBe(false);
      expect(result.error.code).toBe('INVALID_VERBOSE');
    });

    it('accepts multiple valid updates', () => {
      const result = mod.validateUpdates({ model: 'gpt-4', thinking: 'on', verbose: false });
      expect(result.valid).toBe(true);
    });
  });

  describe('parseSessionKey', () => {
    it('correctly parses canonical session key', () => {
      const result = mod.parseSessionKey('agent:agent1:main');
      expect(result.agentId).toBe('agent1');
      expect(result.storedKey).toBe('main');
    });

    it('correctly parses legacy session key with colons', () => {
      const result = mod.parseSessionKey('agent:agent1:some:legacy:key');
      expect(result.agentId).toBe('agent1');
      expect(result.storedKey).toBe('some:legacy:key');
    });

    it('returns null for invalid key', () => {
      const result = mod.parseSessionKey('invalid-key');
      expect(result).toBeNull();
    });
  });

  describe('isCanonicalSessionKey', () => {
    it('returns true for valid canonical key', () => {
      expect(mod.isCanonicalSessionKey('agent:agent1:main')).toBe(true);
      expect(mod.isCanonicalSessionKey('agent:my-agent:thread-1')).toBe(true);
    });

    it('returns false for invalid keys', () => {
      expect(mod.isCanonicalSessionKey('main')).toBe(false);
      expect(mod.isCanonicalSessionKey('agent:main')).toBe(false);
      expect(mod.isCanonicalSessionKey('')).toBe(false);
      expect(mod.isCanonicalSessionKey(null)).toBe(false);
    });
  });
});
