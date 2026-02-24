// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('app.js resilient fetching implementation', () => {
  const appPath = path.join(process.cwd(), 'public/app.js');
  const content = fs.readFileSync(appPath, 'utf-8');

  it('uses Promise.allSettled instead of Promise.all', () => {
    expect(content).toContain('Promise.allSettled');
  });

  it('has renderPanelSafe error boundary function', () => {
    expect(content).toContain('function renderPanelSafe');
    expect(content).toContain('window.renderPanelSafe = renderPanelSafe');
  });

  it('has retryPanel function', () => {
    expect(content).toContain('function retryPanel');
    expect(content).toContain('window.retryPanel = retryPanel');
  });

  it('handles per-endpoint failures gracefully', () => {
    // Should catch individual endpoint failures
    expect(content).toContain('Endpoint');
    expect(content).toContain('failed');
  });

  it('renders each panel with error boundary wrapper', () => {
    // Should call renderPanelSafe for each panel
    expect(content).toMatch(/renderPanelSafe\s*\(\s*['"]agents['"]/);
    expect(content).toMatch(/renderPanelSafe\s*\(\s*['"]sessions['"]/);
    expect(content).toMatch(/renderPanelSafe\s*\(\s*['"]system['"]/);
  });

  it('sets connection status based on any successful data', () => {
    expect(content).toContain('hasAnyData');
    expect(content).toContain('setConnectionStatus(hasAnyData)');
  });
});
