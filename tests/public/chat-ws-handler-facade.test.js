// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'public/chat-ws-handler.js'),
  'utf8'
);

describe('chat-ws-handler facade', () => {
  beforeEach(() => {
    delete window.ChatWsRuntime;
    delete window.ChatWsHistoryLog;
    delete window.ChatWsStreamEvents;
    delete window.ChatWsSystemEvents;
    delete window.ChatWsHandler;
    delete window.WebSocketMessageBatcher;
  });

  it('fails fast when required module APIs are missing', () => {
    expect(() => window.eval(source)).toThrow(
      '[ChatWsHandler] Missing ChatWsRuntime.updateButtons. Check script load order.'
    );
  });

  it('binds handler API when runtime modules are complete', () => {
    const updateButtons = vi.fn();
    const showLive = vi.fn();
    const createRetryBtn = vi.fn();
    const handleHistoryResult = vi.fn();
    const handleLogEntry = vi.fn();
    const handleChatEvent = vi.fn();
    const processChatEventBatch = vi.fn();
    const initializeBatcher = vi.fn();
    const handleSendAck = vi.fn();
    const handleGatewayStatus = vi.fn();

    window.ChatWsRuntime = { updateButtons, showLive, createRetryBtn };
    window.ChatWsHistoryLog = { handleHistoryResult, handleLogEntry };
    window.ChatWsStreamEvents = {
      handleChatEvent,
      processChatEventBatch,
      initializeBatcher
    };
    window.ChatWsSystemEvents = { handleSendAck, handleGatewayStatus };
    window.ChatState = { currentSession: null, cachedModels: null };
    window.ChatInput = { renderModelPicker: vi.fn() };
    window.openChatPane = vi.fn();

    window.eval(source);

    expect(initializeBatcher).toHaveBeenCalledTimes(1);
    expect(window.ChatWsHandler.updateButtons).toBe(updateButtons);
    expect(window.ChatWsHandler.processChatEventBatch).toBe(processChatEventBatch);
    expect(typeof window.ChatWsHandler.handle).toBe('function');
  });
});
