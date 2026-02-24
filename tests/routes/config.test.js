// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

// Test that verifies the implementation in routes/config.js
// The route now uses openclaw.json as primary with source-of-truth.json5 fallback
describe('config route implementation', () => {
  it('imports getGatewayConfig from helpers', async () => {
    const helpers = await import('../../lib/helpers.js');
    expect(typeof helpers.getGatewayConfig).toBe('function');
  });

  it('getGatewayConfig returns expected structure', async () => {
    const { getGatewayConfig } = await import('../../lib/helpers.js');
    const config = getGatewayConfig();
    
    // Should return an object with port property
    expect(config).toHaveProperty('port');
    expect(typeof config.port).toBe('number');
  });

  it('config route file structure is correct', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const filePath = path.default.join(process.cwd(), 'routes/config.js');
    
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Should import getGatewayConfig
    expect(content).toContain('getGatewayConfig');
    expect(content).toContain("require('../lib/helpers')");
    
    // Should check both openclaw.json and source-of-truth.json5
    expect(content).toContain('openclaw.json');
    expect(content).toContain('source-of-truth.json5');
    
    // Should use primary || fallback pattern
    expect(content).toMatch(/primaryConfig\s*\|\|\s*legacyConfig/);
  });
});
