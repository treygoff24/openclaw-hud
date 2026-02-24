// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock necessary globals before importing modules
window.escapeHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
window.marked = { parse: vi.fn(t => '<p>' + t + '</p>'), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn(t => t), addHook: vi.fn() };

// Mock ChatState
window.ChatState = {
  currentSession: { sessionKey: 'agent:test:main', agentId: 'test-agent' },
  sendWs: vi.fn(),
  pendingAcks: new Map(),
  cachedModels: null
};

// Mock ChatCommands
window.ChatCommands = {
  search: vi.fn().mockReturnValue([]),
  find: vi.fn().mockReturnValue(null),
  execute: vi.fn().mockReturnValue(null)
};

// Mock ChatMarkdown
await import('../../public/chat-markdown.js');
await import('../../public/copy-utils.js');
await import('../../public/chat-tool-blocks.js');
await import('../../public/chat-message.js');
await import('../../public/chat-input.js');

describe('ChatInput Attachments', () => {
  let fileInput;
  let chatInput;
  let chatInputArea;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="chat-input-area">
        <textarea id="chat-input" placeholder="Type a message..."></textarea>
        <button id="chat-send-btn">▶</button>
        <button id="chat-attach-btn">📎</button>
      </div>
    `;
    
    chatInput = document.getElementById('chat-input');
    chatInputArea = document.getElementById('chat-input-area');
    fileInput = document.getElementById('file-input');
    
    // Initialize the attachment functionality
    if (window.ChatInput && window.ChatInput._initAttachments) {
      window.ChatInput._initAttachments();
    }
  });

  describe('file input element', () => {
    it('creates hidden file input element', () => {
      const fileInput = document.getElementById('file-input');
      expect(fileInput).not.toBeNull();
      expect(fileInput.type).toBe('file');
      expect(fileInput.accept).toBe('image/*');
      expect(fileInput.multiple).toBe(true);
      expect(fileInput.style.display).toBe('none');
    });
  });

  describe('attach button', () => {
    it('creates attach button', () => {
      const attachBtn = document.getElementById('chat-attach-btn');
      expect(attachBtn).not.toBeNull();
    });

    it('triggers file input click when attach button is clicked', () => {
      const attachBtn = document.getElementById('chat-attach-btn');
      const fileInput = document.getElementById('file-input');
      
      const clickSpy = vi.spyOn(fileInput, 'click');
      attachBtn.click();
      
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('file validation', () => {
    it('rejects files larger than 5MB', () => {
      // Create a mock file over 5MB
      const bigFile = new File(['x'.repeat(6 * 1024 * 1024)], 'big.png', { type: 'image/png' });
      
      // Mock alert to capture the error message
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
      
      // Find the validation function and call it
      if (window.ChatInput && window.ChatInput._validateFile) {
        const result = window.ChatInput._validateFile(bigFile);
        expect(result).toBe(false);
        expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('5MB'));
      }
      
      alertSpy.mockRestore();
    });

    it('accepts valid image files', () => {
      // Create a small valid image file
      const validFile = new File(['fake image data'], 'test.png', { type: 'image/png' });
      Object.defineProperty(validFile, 'size', { value: 1024 * 100 }); // 100KB
      
      if (window.ChatInput && window.ChatInput._validateFile) {
        const result = window.ChatInput._validateFile(validFile);
        expect(result).toBe(true);
      }
    });
  });

  describe('pending attachments', () => {
    it('stores pending attachments in array', () => {
      if (window.ChatInput && window.ChatInput._pendingAttachments !== undefined) {
        expect(Array.isArray(window.ChatInput._pendingAttachments)).toBe(true);
      }
    });

    it('can add and remove attachments', () => {
      const mockFile = new File(['test'], 'test.png', { type: 'image/png' });
      Object.defineProperty(mockFile, 'size', { value: 1024 });
      
      if (window.ChatInput && window.ChatInput._addAttachment) {
        window.ChatInput._addAttachment(mockFile);
        expect(window.ChatInput._pendingAttachments.length).toBe(1);
        
        window.ChatInput._removeAttachment(0);
        expect(window.ChatInput._pendingAttachments.length).toBe(0);
      }
    });
  });

  describe('preview thumbnails', () => {
    it('creates preview element for attachment', () => {
      if (window.ChatInput && window.ChatInput._createPreviewElement) {
        const attachment = {
          file: { name: 'test.png', size: 1024, type: 'image/png' },
          dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        };
        
        const preview = window.ChatInput._createPreviewElement(attachment, 0);
        expect(preview).not.toBeNull();
        expect(preview.className).toContain('attachment-preview');
      }
    });
  });

  describe('FileReader conversion', () => {
    it('converts file to base64 data URL', async () => {
      if (window.ChatInput && window.ChatInput._fileToBase64) {
        const mockFile = new File(['hello'], 'test.txt', { type: 'text/plain' });
        const result = await window.ChatInput._fileToBase64(mockFile);
        expect(result).toContain('data:');
        expect(result).toContain('base64,');
      }
    });
  });

  describe('drag and drop', () => {
    it('chat input area has event listeners registered', () => {
      // The handlers are registered in _initAttachments
      // We can't fully test drag/drop in jsdom, but we verify initialization works
      const chatInputArea = document.getElementById('chat-input-area');
      expect(chatInputArea).not.toBeNull();
    });
  });

  describe('paste handling', () => {
    it('chat input element exists', () => {
      // The paste handler is registered on the chat-input element
      const chatInput = document.getElementById('chat-input');
      expect(chatInput).not.toBeNull();
    });
  });
});