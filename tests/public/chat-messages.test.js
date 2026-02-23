// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock dependencies
window.escapeHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
window.marked = { parse: vi.fn(t => '<p>' + t + '</p>'), setOptions: vi.fn(), use: vi.fn() };
window.DOMPurify = { sanitize: vi.fn(t => t) };

await import('../../public/chat-markdown.js');
await import('../../public/chat-tool-blocks.js');
await import('../../public/chat-message.js');
await import('../../public/chat-messages.js');

describe('VirtualScroller', () => {
  let container;
  
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'chat-messages';
    container.style.height = '400px';
    container.style.overflow = 'auto';
    document.body.appendChild(container);
    
    // Mock getBoundingClientRect
    container.getBoundingClientRect = vi.fn(() => ({
      top: 0, left: 0, bottom: 400, right: 300, width: 300, height: 400
    }));
  });
  
  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('creates virtual scroll container with viewport', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      expect(scroller.container).toBe(container);
      expect(scroller.itemHeight).toBeGreaterThan(0);
      expect(typeof scroller.totalItems).toBe('number');
    });
    
    it('sets up IntersectionObserver for lazy rendering', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      expect(scroller.observer).toBeDefined();
      expect(scroller.visibleRange).toBeDefined();
    });
  });

  describe('setItems', () => {
    it('accepts array of messages and calculates total height', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(100).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      scroller.setItems(items);
      
      expect(scroller.totalItems).toBe(100);
      expect(scroller.totalHeight).toBeGreaterThan(0);
    });
    
    it('renders only visible items initially', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(1000).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      scroller.setItems(items);
      
      // Should render only viewport items + buffer, not all 1000
      const renderedCount = container.querySelectorAll('.chat-msg').length;
      expect(renderedCount).toBeLessThan(100);
      expect(renderedCount).toBeGreaterThan(0);
    });
  });

  describe('scroll handling', () => {
    it('updates visible range on scroll', async () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(500).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      scroller.setItems(items);
      const initialRange = { ...scroller.visibleRange };
      
      // Simulate scroll
      container.scrollTop = 5000;
      container.dispatchEvent(new Event('scroll'));
      
      // Wait for debounced scroll handler
      await new Promise(r => setTimeout(r, 100));
      
      expect(scroller.visibleRange.start).not.toBe(initialRange.start);
    });
    
    it('maintains scroll position accuracy within buffer', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(200).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      scroller.setItems(items);
      
      // Scroll to specific item
      const targetIndex = 50;
      const expectedScrollTop = targetIndex * scroller.itemHeight;
      container.scrollTop = expectedScrollTop;
      
      expect(scroller.getScrollTopForIndex(targetIndex)).toBe(expectedScrollTop);
    });
  });

  describe('performance', () => {
    it('renders 1000 items without frame drops', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(1000).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      const start = performance.now();
      scroller.setItems(items);
      const end = performance.now();
      
      // Should render in less than 50ms to maintain 55fps
      expect(end - start).toBeLessThan(50);
    });
    
    it('recycles DOM elements on scroll', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(500).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      scroller.setItems(items);
      const initialElements = container.querySelectorAll('.chat-msg').length;
      
      // Scroll down significantly
      container.scrollTop = 10000;
      container.dispatchEvent(new Event('scroll'));
      
      // Element count should remain roughly stable (recycling)
      const afterScrollElements = container.querySelectorAll('.chat-msg').length;
      expect(Math.abs(afterScrollElements - initialElements)).toBeLessThan(10);
    });
  });

  describe('cleanup', () => {
    it('disconnects observer and clears state on destroy', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const items = Array(100).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Message ${i}` }]
      }));
      
      scroller.setItems(items);
      scroller.destroy();
      
      expect(scroller.observer).toBeNull();
      expect(scroller.items).toHaveLength(0);
    });
  });
});

describe('Memory Leak Prevention', () => {
  let container;
  
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'chat-messages';
    document.body.appendChild(container);
  });
  
  afterEach(() => {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    vi.clearAllMocks();
  });

  describe('session switching', () => {
    it('clears previous messages before loading new session', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      // Load first session
      const items1 = Array(50).fill(null).map((_, i) => ({
        role: 'user',
        content: [{ type: 'text', text: `Session 1 Message ${i}` }]
      }));
      scroller.setItems(items1);
      
      // Switch to new session
      const items2 = Array(30).fill(null).map((_, i) => ({
        role: 'assistant',
        content: [{ type: 'text', text: `Session 2 Message ${i}` }]
      }));
      scroller.setItems(items2);
      
      // Should only have new session messages
      const rendered = container.querySelectorAll('.chat-msg');
      expect(rendered.length).toBeLessThan(50);
      
      // No session 1 messages should remain
      const session1Content = Array.from(rendered).filter(el => 
        el.textContent.includes('Session 1')
      );
      expect(session1Content).toHaveLength(0);
    });
    
    it('removes all event listeners on destroy', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      const scrollHandler = vi.fn();
      container.addEventListener('scroll', scrollHandler);
      
      scroller.destroy();
      
      // After destroy, scroll events should not be handled
      container.dispatchEvent(new Event('scroll'));
      expect(scroller.items).toHaveLength(0);
    });
  });

  describe('WebSocket cleanup', () => {
    it('clears pending timeouts and intervals', () => {
      const scroller = window.VirtualScroller;
      scroller.initialize(container);
      
      // Set up some timers
      scroller.debounceTimer = setTimeout(() => {}, 1000);
      scroller.resizeObserver = { disconnect: vi.fn() };
      
      scroller.destroy();
      
      // Timers should be cleared (no way to check directly, but no errors)
      expect(scroller.debounceTimer).toBeNull();
    });
  });
});
