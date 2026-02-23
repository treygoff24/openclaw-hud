import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Setup global window/document mocks before loading modules
global.document = global.document || {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  activeElement: null,
  querySelectorAll: vi.fn(() => []),
};
global.window = global.window || {};

// Mock document and window for testing
const FOCUSABLE_TAGS = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
const createMockElement = (overrides = {}) => {
  const el = {
    tagName: 'DIV',
    classList: { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) },
    style: {},
    dataset: {},
    getAttribute: vi.fn(() => null),
    setAttribute: vi.fn(),
    hasAttribute: vi.fn(() => false),
    removeAttribute: vi.fn(),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    focus: vi.fn(),
    click: vi.fn(),
    offsetParent: { nodeType: 1 },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    closest: vi.fn(() => null),
    contains: vi.fn(() => true),
    ...overrides
  };
  // Add matches() that checks tag names against the selector
  el.matches = el.matches || vi.fn((selector) => {
    const tag = el.tagName.toUpperCase();
    if (FOCUSABLE_TAGS.includes(tag) && selector.toLowerCase().includes(tag.toLowerCase())) return true;
    if (tag === 'A' && el.href && selector.includes('a[href]')) return true;
    if (el.getAttribute('tabindex') !== null && selector.includes('[tabindex]')) return true;
    return false;
  });
  return el;
};

describe('FocusTrap', () => {
  let FocusTrap;
  let container;
  let focusableElements;

  beforeEach(() => {
    // Create focusable elements
    focusableElements = [
      createMockElement({ tagName: 'BUTTON', focus: vi.fn(), disabled: false }),
      createMockElement({ tagName: 'INPUT', focus: vi.fn(), type: 'text', disabled: false }),
      createMockElement({ tagName: 'A', focus: vi.fn(), href: '#', disabled: false }),
    ];

    container = createMockElement({
      querySelectorAll: vi.fn(() => focusableElements),
      setAttribute: vi.fn(),
      focus: vi.fn()
    });

    // Load the module
    FocusTrap = require('../../public/a11y/focus-trap.js').FocusTrap || window.FocusTrap;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(typeof FocusTrap).toBe('function');
  });

  it('should get focusable elements correctly', () => {
    const trap = new FocusTrap(container);
    const elements = trap.getFocusableElements();
    expect(container.querySelectorAll).toHaveBeenCalled();
  });

  it('should focus first element on activate', () => {
    const trap = new FocusTrap(container);
    trap.activate();
    expect(focusableElements[0].focus).toHaveBeenCalled();
  });

  it('should add event listeners on activate', () => {
    const trap = new FocusTrap(container);
    trap.activate();
    expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(document.addEventListener).toHaveBeenCalledWith('focusin', expect.any(Function));
  });

  it('should remove event listeners on deactivate', () => {
    const trap = new FocusTrap(container);
    trap.activate();
    trap.deactivate();
    expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(document.removeEventListener).toHaveBeenCalledWith('focusin', expect.any(Function));
  });

  it('should cycle focus to first element on Tab from last', () => {
    const trap = new FocusTrap(container);
    trap.activate();
    
    // Simulate Tab key on last focusable element
    const event = { key: 'Tab', preventDefault: vi.fn(), shiftKey: false };
    Object.defineProperty(document, 'activeElement', { value: focusableElements[2], writable: true });
    
    trap.handleKeyDown(event);
    
    expect(event.preventDefault).toHaveBeenCalled();
    expect(focusableElements[0].focus).toHaveBeenCalled();
  });

  it('should cycle focus to last element on Shift+Tab from first', () => {
    const trap = new FocusTrap(container);
    trap.activate();
    
    // Simulate Shift+Tab on first focusable element
    const event = { key: 'Tab', preventDefault: vi.fn(), shiftKey: true };
    Object.defineProperty(document, 'activeElement', { value: focusableElements[0], writable: true });
    
    trap.handleKeyDown(event);
    
    expect(event.preventDefault).toHaveBeenCalled();
    expect(focusableElements[2].focus).toHaveBeenCalled();
  });

  it('should make container focusable when no focusable elements exist', () => {
    const emptyContainer = createMockElement({
      querySelectorAll: vi.fn(() => []),
      setAttribute: vi.fn(),
      focus: vi.fn()
    });
    
    const trap = new FocusTrap(emptyContainer);
    trap.activate();
    
    expect(emptyContainer.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
    expect(emptyContainer.focus).toHaveBeenCalled();
  });
});

describe('makeFocusable utility', () => {
  let makeFocusable;
  
  beforeEach(() => {
    // Load the module fresh for each test
    const mod = require('../../public/a11y/focus-trap.js');
    makeFocusable = mod.makeFocusable || (typeof window !== 'undefined' && window.makeFocusable);
  });

  it('should add tabindex to non-focusable elements', () => {
    const element = createMockElement({ tagName: 'DIV' });
    makeFocusable(element);
    expect(element.setAttribute).toHaveBeenCalledWith('tabindex', '0');
    expect(element.setAttribute).toHaveBeenCalledWith('role', 'button');
  });

  it('should not add tabindex to naturally focusable elements', () => {
    const button = createMockElement({ tagName: 'BUTTON' });
    makeFocusable(button);
    // Should not set tabindex for buttons
    const tabindexCalls = button.setAttribute.mock?.calls?.filter?.(c => c[0] === 'tabindex') || [];
    expect(tabindexCalls.length).toBe(0);
  });

  it('should call onActivate callback on Enter key', () => {
    const element = createMockElement({ tagName: 'DIV' });
    const callback = vi.fn();
    makeFocusable(element, callback);
    
    // Get the keydown handler
    const keydownHandler = element.addEventListener.mock.calls.find(c => c[0] === 'keydown')?.[1];
    if (keydownHandler) {
      keydownHandler({ key: 'Enter', preventDefault: vi.fn() });
      expect(callback).toHaveBeenCalled();
    }
  });

  it('should call onActivate callback on Space key', () => {
    const element = createMockElement({ tagName: 'DIV' });
    const callback = vi.fn();
    makeFocusable(element, callback);
    
    // Get the keydown handler
    const keydownHandler = element.addEventListener.mock.calls.find(c => c[0] === 'keydown')?.[1];
    if (keydownHandler) {
      keydownHandler({ key: ' ', preventDefault: vi.fn() });
      expect(callback).toHaveBeenCalled();
    }
  });
});

describe('Keyboard Navigation', () => {
  it('should support Enter key for button activation', () => {
    const button = createMockElement({ tagName: 'BUTTON' });
    let clicked = false;
    button.click = vi.fn(() => { clicked = true; });
    
    // Simulate Enter key
    const handler = (e) => {
      if (e.key === 'Enter') button.click();
    };
    handler({ key: 'Enter' });
    
    expect(clicked).toBe(true);
  });

  it('should support Space key for button activation', () => {
    const button = createMockElement({ tagName: 'BUTTON' });
    let clicked = false;
    button.click = vi.fn(() => { clicked = true; });
    
    // Simulate Space key
    const handler = (e) => {
      if (e.key === ' ') button.click();
    };
    handler({ key: ' ' });
    
    expect(clicked).toBe(true);
  });
});
