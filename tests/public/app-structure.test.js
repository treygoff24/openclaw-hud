// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('App facade and split runtime structure', () => {
  const appFacadePath = path.join(process.cwd(), 'public/app.js');
  const appFacadeContent = fs.readFileSync(appFacadePath, 'utf-8');
  const appDataPath = path.join(process.cwd(), 'public/app/data.js');
  const appDataContent = fs.readFileSync(appDataPath, 'utf-8');
  const indexPath = path.join(process.cwd(), 'public/index.html');
  const indexContent = fs.readFileSync(indexPath, 'utf-8');

  it('declares required HUDApp module APIs in the facade guard', () => {
    expect(appFacadeContent).toContain('diagnostics.ensureHudDiagLogger');
    expect(appFacadeContent).toContain('status.createStatusController');
    expect(appFacadeContent).toContain('ui.createUiController');
    expect(appFacadeContent).toContain('data.createDataController');
    expect(appFacadeContent).toContain('polling.createPollingController');
    expect(appFacadeContent).toContain('ws.createWsController');
    expect(appFacadeContent).toContain('bootstrap.initApp');
  });

  it('throws clear bootstrap errors when HUDApp is missing or incomplete', () => {
    expect(appFacadeContent).toContain('window.HUDApp is not initialized');
    expect(appFacadeContent).toContain('missing required module APIs');
    expect(appFacadeContent).toContain('console.error(message)');
  });

  it('exposes compatibility globals from bootstrap runtime', () => {
    expect(appFacadeContent).toContain('window.HUD.fetchAll = runtime.fetchAll');
    expect(appFacadeContent).toContain('window.HUD.showToast = runtime.showToast');
    expect(appFacadeContent).toContain('window.renderPanelSafe = runtime.renderPanelSafe');
    expect(appFacadeContent).toContain('window.retryPanel = runtime.retryPanel');
  });

  it('keeps resilient fetch and panel-safe rendering in app/data.js', () => {
    expect(appDataContent).toContain('Promise.allSettled');
    expect(appDataContent).toContain('Endpoint ');
    expect(appDataContent).toContain('failed:');
    expect(appDataContent).toMatch(/renderPanelSafe\s*\(\s*['"]agents['"]/);
    expect(appDataContent).toMatch(/renderPanelSafe\s*\(\s*['"]sessions['"]/);
    expect(appDataContent).toMatch(/renderPanelSafe\s*\(\s*['"]system['"]/);
    expect(appDataContent).toContain('setConnectionStatus(hasAnyData)');
  });

  it('loads split app modules before app.js facade in index.html', () => {
    const diagnosticsPos = indexContent.indexOf('script src="app/diagnostics.js"');
    const statusPos = indexContent.indexOf('script src="app/status.js"');
    const uiPos = indexContent.indexOf('script src="app/ui.js"');
    const dataPos = indexContent.indexOf('script src="app/data.js"');
    const pollingPos = indexContent.indexOf('script src="app/polling.js"');
    const wsPos = indexContent.indexOf('script src="app/ws.js"');
    const bootstrapPos = indexContent.indexOf('script src="app/bootstrap.js"');
    const appFacadePos = indexContent.indexOf('script src="app.js"');

    expect(diagnosticsPos).toBeGreaterThan(-1);
    expect(statusPos).toBeGreaterThan(diagnosticsPos);
    expect(uiPos).toBeGreaterThan(statusPos);
    expect(dataPos).toBeGreaterThan(uiPos);
    expect(pollingPos).toBeGreaterThan(dataPos);
    expect(wsPos).toBeGreaterThan(pollingPos);
    expect(bootstrapPos).toBeGreaterThan(wsPos);
    expect(appFacadePos).toBeGreaterThan(bootstrapPos);
  });
});
