import { describe, it, expect, vi, beforeEach } from 'vitest';

let mod;
const MAIN_KEY = 'agent:agent1:main';

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
  return { 
    connected, 
    on: vi.fn(), 
    request: vi.fn().mockResolvedValue({}) 
  };
}

describe('chat-handlers attachments', () => {
  describe('handleChatMessage with attachments', () => {
    it('chat-send with attachments sends content blocks to gateway', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      const base64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      
      gw.request.mockResolvedValue({ runId: 'r1', status: 'queued' });
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'Check this image',
        attachments: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Image
            }
          }
        ],
        idempotencyKey: 'ik1' 
      }, gw);
      
      // Verify the gateway was called with content blocks
      expect(gw.request).toHaveBeenCalledWith('chat.send', expect.objectContaining({
        sessionKey: MAIN_KEY,
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text' }),
          expect.objectContaining({ type: 'image' })
        ])
      }));
    });

    it('chat-send with multiple attachments sends all to gateway', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      gw.request.mockResolvedValue({ runId: 'r1', status: 'queued' });
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'Two images',
        attachments: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img1' } },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img2' } }
        ],
        idempotencyKey: 'ik2' 
      }, gw);
      
      const callArgs = gw.request.mock.calls[0];
      const content = callArgs[1].content;
      expect(content.filter(b => b.type === 'image')).toHaveLength(2);
    });

    it('chat-send without attachments works normally', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      gw.request.mockResolvedValue({ runId: 'r1', status: 'queued' });
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'Hello world',
        idempotencyKey: 'ik4' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
      
      // Should send as text content block
      expect(gw.request).toHaveBeenCalledWith('chat.send', expect.objectContaining({
        sessionKey: MAIN_KEY,
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: 'Hello world' })
        ])
      }));
    });

    it('chat-send rejects attachments larger than 10MB', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      // Large base64 string that would exceed 10MB when decoded
      // base64 expands by ~1.33x, so 14M characters = ~10.5MB decoded
      const largeData = 'A'.repeat(14 * 1024 * 1024);
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'Large image',
        attachments: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: largeData } }
        ],
        idempotencyKey: 'ik3' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('ATTACHMENT_TOO_LARGE');
      expect(sent.error.message).toContain('10MB');
    });

    it('chat-send with only attachments (no text) works', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      gw.request.mockResolvedValue({ runId: 'r1', status: 'queued' });
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: '',
        attachments: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'small' } }
        ],
        idempotencyKey: 'ik5' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(true);
    });

    it('chat-send rejects non-image attachments', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'File',
        attachments: [
          { type: 'file', source: { type: 'base64', media_type: 'application/pdf', data: 'abc' } }
        ],
        idempotencyKey: 'ik6' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('INVALID_ATTACHMENT_TYPE');
    });

    it('chat-send accepts valid image media types (png, jpeg, gif, webp)', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      gw.request.mockResolvedValue({ runId: 'r1', status: 'queued' });
      
      const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      
      for (const mediaType of validTypes) {
        vi.clearAllMocks();
        
        await mod.handleChatMessage(ws, { 
          type: 'chat-send', 
          sessionKey: MAIN_KEY, 
          message: `Test ${mediaType}`,
          attachments: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: 'small' } }
          ],
          idempotencyKey: `ik-${mediaType}` 
        }, gw);
        
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.ok).toBe(true);
        expect(sent.error).toBeUndefined();
      }
    });

    it('chat-send rejects text/html media type', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'Malicious',
        attachments: [
          { type: 'image', source: { type: 'base64', media_type: 'text/html', data: '<script>alert(1)</script>' } }
        ],
        idempotencyKey: 'ik-html' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('INVALID_MEDIA_TYPE');
      expect(sent.error.message).toContain('text/html');
    });

    it('chat-send rejects image/svg+xml media type (SVG can contain scripts)', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'SVG',
        attachments: [
          { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: '<svg><script>alert(1)</script></svg>' } }
        ],
        idempotencyKey: 'ik-svg' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('INVALID_MEDIA_TYPE');
      expect(sent.error.message).toContain('image/svg+xml');
    });

    it('chat-send rejects attachments with missing media_type', async () => {
      const ws = mockWs();
      const gw = mockGateway();
      
      await mod.handleChatMessage(ws, { 
        type: 'chat-send', 
        sessionKey: MAIN_KEY, 
        message: 'No media type',
        attachments: [
          { type: 'image', source: { type: 'base64', data: 'nodata' } }
        ],
        idempotencyKey: 'ik-nomedia' 
      }, gw);
      
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.ok).toBe(false);
      expect(sent.error.code).toBe('INVALID_MEDIA_TYPE');
    });
  });
});