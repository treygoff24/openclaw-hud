// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadScript(relativePath) {
  const code = readFileSync(join(__dirname, '../../../public', relativePath), 'utf-8');
  new Function(code)();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="model-usage"></div>';
  window.HUD = {};
  // escapeHtml is needed by models.js
  window.escapeHtml = function(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  };
  loadScript('panels/models.js');
});

describe('formatTokens', () => {
  it('returns plain number for < 1000', () => {
    expect(HUD.models.formatTokens(500)).toBe('500');
  });
  it('returns K for thousands', () => {
    expect(HUD.models.formatTokens(1500)).toBe('1.5K');
  });
  it('returns M for millions', () => {
    expect(HUD.models.formatTokens(1500000)).toBe('1.5M');
  });
  it('handles exact 1000', () => {
    expect(HUD.models.formatTokens(1000)).toBe('1.0K');
  });
  it('handles exact 1000000', () => {
    expect(HUD.models.formatTokens(1000000)).toBe('1.0M');
  });
  it('handles 0', () => {
    expect(HUD.models.formatTokens(0)).toBe('0');
  });
});

describe('render', () => {
  it('renders model bars for usage data', () => {
    HUD.models.render({
      'openai/gpt-4': {
        totalTokens: 5000,
        inputTokens: 3000,
        outputTokens: 1500,
        cacheReadTokens: 500,
        totalCost: 0.15,
        agents: { myAgent: { totalTokens: 5000 } }
      }
    });
    const el = document.getElementById('model-usage');
    expect(el.querySelectorAll('.model-bar-row').length).toBe(1);
    expect(el.querySelector('.model-bar-label').textContent).toContain('gpt-4');
    expect(el.querySelector('.model-bar-label').textContent).toContain('5.0K tokens');
    expect(el.querySelector('.token-breakdown').textContent).toContain('IN: 3.0K');
    expect(el.querySelector('.token-breakdown').textContent).toContain('OUT: 1.5K');
    expect(el.querySelector('.token-cost').textContent).toBe('$0.15');
    expect(el.querySelector('.model-agents').textContent).toContain('myAgent');
  });

  it('renders empty state', () => {
    HUD.models.render({});
    const el = document.getElementById('model-usage');
    expect(el.textContent).toContain('No model data yet');
  });

  it('sorts by totalTokens descending', () => {
    HUD.models.render({
      'a/small': { totalTokens: 100, inputTokens: 50, outputTokens: 50, cacheReadTokens: 0, totalCost: 0, agents: {} },
      'b/big': { totalTokens: 9000, inputTokens: 5000, outputTokens: 4000, cacheReadTokens: 0, totalCost: 0, agents: {} }
    });
    const labels = document.querySelectorAll('.model-bar-label');
    expect(labels[0].textContent).toContain('big');
    expect(labels[1].textContent).toContain('small');
  });

  it('hides cost when zero', () => {
    HUD.models.render({
      'x/model': { totalTokens: 100, inputTokens: 50, outputTokens: 50, cacheReadTokens: 0, totalCost: 0, agents: {} }
    });
    expect(document.querySelector('.token-cost')).toBeNull();
  });
});
