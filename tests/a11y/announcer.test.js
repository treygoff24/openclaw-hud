import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Helper: create a mock DOM element that tracks attributes properly.
 */
function createMockEl() {
  const attrs = {};
  return {
    textContent: '',
    style: {},
    cssText: '',
    setAttribute(name, value) { attrs[name] = value; },
    getAttribute(name) { return attrs[name] ?? null; },
    classList: { add: vi.fn(), remove: vi.fn() },
  };
}

describe('A11yAnnouncer', () => {
  let appendedElements;

  beforeEach(() => {
    appendedElements = [];

    global.document = {
      createElement: vi.fn(() => createMockEl()),
      body: {
        appendChild: vi.fn((el) => {
          appendedElements.push(el);
        }),
      },
      addEventListener: vi.fn(),
    };
    global.window = {};

    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete global.window.A11yAnnouncer;
  });

  function getRegion(type) {
    return appendedElements.find(el => el.getAttribute('aria-live') === type);
  }

  it('should create polite and assertive live regions on init', async () => {
    await import('../../public/a11y/announcer.js');

    expect(document.createElement).toHaveBeenCalledWith('div');
    expect(document.body.appendChild).toHaveBeenCalledTimes(2);
    expect(getRegion('polite')).toBeTruthy();
    expect(getRegion('assertive')).toBeTruthy();
  });

  it('should announce messages politely by default', async () => {
    await import('../../public/a11y/announcer.js');
    const announcer = window.A11yAnnouncer;

    announcer.announce('Test message');
    vi.advanceTimersByTime(20);

    expect(getRegion('polite').textContent).toBe('Test message');
  });

  it('should announce messages assertively when specified', async () => {
    await import('../../public/a11y/announcer.js');
    const announcer = window.A11yAnnouncer;

    announcer.announceAssertive('Urgent message');
    vi.advanceTimersByTime(20);

    expect(getRegion('assertive').textContent).toBe('Urgent message');
  });

  it('should debounce messages with the same key', async () => {
    await import('../../public/a11y/announcer.js');
    const announcer = window.A11yAnnouncer;

    announcer.announce('Message 1', 'test-key', 100);
    announcer.announce('Message 2', 'test-key', 100);

    vi.advanceTimersByTime(150);

    expect(getRegion('polite').textContent).toBe('Message 2');
  });

  it('should clear text before setting new message', async () => {
    await import('../../public/a11y/announcer.js');
    const announcer = window.A11yAnnouncer;
    const polite = getRegion('polite');

    polite.textContent = 'Old message';
    announcer.speak('New message', 'polite');

    // Immediately after speak(), the region is cleared
    expect(polite.textContent).toBe('');

    vi.advanceTimersByTime(20);
    expect(polite.textContent).toBe('New message');
  });

  it('should clean up timers on destroy', async () => {
    await import('../../public/a11y/announcer.js');
    const announcer = window.A11yAnnouncer;

    announcer.announce('Message', 'key1', 1000);
    announcer.announce('Message', 'key2', 1000);

    expect(announcer.debounceTimers.size).toBeGreaterThan(0);

    announcer.destroy();
    expect(announcer.debounceTimers.size).toBe(0);
  });
});

describe('ARIA Live Regions in HTML', () => {
  it('should have aria-live polite on chat messages container', () => {
    const html = require('fs').readFileSync('./public/index.html', 'utf8');
    expect(html).toMatch(/role="log"/);
    expect(html).toMatch(/aria-live="polite"/);
  });

  it('should have aria-live assertive on gateway banner', () => {
    const html = require('fs').readFileSync('./public/index.html', 'utf8');
    expect(html).toMatch(/gateway-banner[^>]*role="alert"/);
    expect(html).toMatch(/gateway-banner[^>]*aria-live="assertive"/);
  });

  it('should have aria-live polite on activity feed', () => {
    const html = require('fs').readFileSync('./public/index.html', 'utf8');
    expect(html).toMatch(/activity-feed[^>]*role="log"/);
    expect(html).toMatch(/activity-feed[^>]*aria-live="polite"/);
  });

  it('should have aria-live on toast notification', () => {
    const html = require('fs').readFileSync('./public/index.html', 'utf8');
    expect(html).toMatch(/id="toast"[^>]*role="status"/);
    expect(html).toMatch(/id="toast"[^>]*aria-live="polite"/);
  });

  it('should have aria-live on dynamic count elements', () => {
    const html = require('fs').readFileSync('./public/index.html', 'utf8');
    expect(html).toMatch(/id="agent-count"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="cron-count"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="session-count"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="activity-count"[^>]*aria-live="polite"/);
    expect(html).toMatch(/id="tree-count"[^>]*aria-live="polite"/);
  });
});

describe('ARIA Labels and Roles', () => {
  let html;

  beforeEach(() => {
    const fs = require('fs');
    html = fs.readFileSync('./public/index.html', 'utf8');
  });

  it('should have main role on dashboard', () => {
    expect(html).toMatch(/id="dashboard"[^>]*role="main"/);
  });

  it('should have complementary role on chat pane', () => {
    expect(html).toMatch(/id="chat-pane"[^>]*role="complementary"/);
  });

  it('should have banner role on headers', () => {
    expect(html).toMatch(/header[^>]*role="banner"/);
  });

  it('should have dialog role on modals with aria-modal', () => {
    expect(html).toMatch(/id="spawn-modal"[^>]*role="dialog"/);
    expect(html).toMatch(/id="spawn-modal"[^>]*aria-modal="true"/);
    expect(html).toMatch(/id="cron-modal"[^>]*role="dialog"/);
    expect(html).toMatch(/id="cron-modal"[^>]*aria-modal="true"/);
  });

  it('should have list role on list containers', () => {
    expect(html).toMatch(/id="agents-list"[^>]*role="list"/);
    expect(html).toMatch(/id="cron-list"[^>]*role="list"/);
    expect(html).toMatch(/id="sessions-list"[^>]*role="list"/);
  });

  it('should have tree role on session tree', () => {
    expect(html).toMatch(/id="tree-body"[^>]*role="tree"/);
  });

  it('should have aria-label on buttons without visible text', () => {
    expect(html).toMatch(/id="chat-send-btn"[^>]*aria-label="Send message"/);
    expect(html).toMatch(/id="chat-stop-btn"[^>]*aria-label="Stop generation"/);
    expect(html).toMatch(/id="open-spawn-btn"[^>]*aria-label="Launch new session"/);
    expect(html).toMatch(/id="spawn-modal-close"[^>]*aria-label="Close spawn dialog"/);
    expect(html).toMatch(/id="cron-modal-close"[^>]*aria-label="Close cron editor"/);
  });

  it('should have aria-labelledby linking headers to sections', () => {
    expect(html).toMatch(/aria-labelledby="agents-heading"/);
    expect(html).toMatch(/aria-labelledby="cron-heading"/);
    expect(html).toMatch(/aria-labelledby="system-heading"/);
    expect(html).toMatch(/aria-labelledby="tree-heading"/);
    expect(html).toMatch(/aria-labelledby="models-heading"/);
    expect(html).toMatch(/aria-labelledby="sessions-heading"/);
    expect(html).toMatch(/aria-labelledby="activity-heading"/);
  });

  it('should have aria-label on form elements', () => {
    expect(html).toMatch(/id="chat-input"[^>]*aria-label="Message text"/);
    expect(html).toMatch(/id="agent-search"[^>]*aria-label="Filter agents"/);
  });

  it('should have skip link', () => {
    expect(html).toMatch(/class="skip-link"/);
    expect(html).toMatch(/href="#dashboard"/);
  });
});
