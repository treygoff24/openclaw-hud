// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

document.body.innerHTML = `
  <div id="spawn-modal" class="modal-overlay">
    <input id="spawn-label" />
    <select id="spawn-mode"><option value="run">run</option><option value="session">session</option></select>
    <input id="spawn-timeout" />
    <textarea id="spawn-files"></textarea>
    <textarea id="spawn-prompt"></textarea>
    <select id="spawn-agent"></select>
    <select id="spawn-model"></select>
    <div id="spawn-error" style="display:none"></div>
    <button id="open-spawn-btn"></button>
    <button id="spawn-cancel-btn"></button>
    <button id="spawn-modal-close"></button>
    <button id="spawn-launch-btn"></button>
  </div>
  <div id="toast" class="toast"></div>
`;
window.HUD = window.HUD || {};
window.HUD.showToast = vi.fn();
window.HUD.fetchAll = vi.fn();
window._agents = [{ id: 'bot1' }, { id: 'bot2' }];
window._modelAliases = [{ alias: 'gpt4', fullId: 'openai/gpt-4' }];
window.escapeHtml = function(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
};

await import('../../../public/panels/spawn.js');

describe('spawn.open', () => {
  it('opens the spawn modal', () => {
    HUD.spawn.open();
    expect(document.getElementById('spawn-modal').classList.contains('active')).toBe(true);
  });

  it('populates agent select with available agents', () => {
    HUD.spawn.open();
    const options = document.getElementById('spawn-agent').querySelectorAll('option');
    expect(options.length).toBe(2);
    expect(options[0].value).toBe('bot1');
  });

  it('populates model select', () => {
    HUD.spawn.open();
    const options = document.getElementById('spawn-model').querySelectorAll('option');
    expect(options.length).toBe(1);
    expect(options[0].value).toBe('openai/gpt-4');
  });

  it('resets form fields', () => {
    document.getElementById('spawn-label').value = 'old';
    HUD.spawn.open();
    expect(document.getElementById('spawn-label').value).toBe('');
    expect(document.getElementById('spawn-timeout').value).toBe('300');
  });
});

describe('spawn.close', () => {
  it('closes the modal', () => {
    HUD.spawn.open();
    HUD.spawn.close();
    expect(document.getElementById('spawn-modal').classList.contains('active')).toBe(false);
  });
});

describe('spawn.launch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ ok: true })
    }));
  });

  it('shows error when prompt is empty', async () => {
    HUD.spawn.open();
    document.getElementById('spawn-prompt').value = '';
    await HUD.spawn.launch();
    expect(document.getElementById('spawn-error').textContent).toContain('required');
    expect(document.getElementById('spawn-error').style.display).toBe('block');
  });

  it('calls fetch with correct data when valid', async () => {
    HUD.spawn.open();
    document.getElementById('spawn-prompt').value = 'Do something';
    await HUD.spawn.launch();
    expect(window.fetch).toHaveBeenCalledWith('/api/spawn', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('handles fetch error gracefully', async () => {
    window.fetch = vi.fn(() => Promise.resolve({
      ok: false, json: () => Promise.resolve({ error: 'spawn failed' })
    }));
    HUD.spawn.open();
    document.getElementById('spawn-prompt').value = 'Do something';
    await HUD.spawn.launch();
    expect(document.getElementById('spawn-error').textContent).toContain('spawn failed');
  });
});
