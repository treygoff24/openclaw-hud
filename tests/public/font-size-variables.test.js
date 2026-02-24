// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';

describe('CSS Font Size Variables', () => {
  it('should define font size CSS variables in :root', async () => {
    // Load the base.css file which contains :root variables
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/base.css', 'utf8')
    );
    
    // Check that all expected font size variables are defined
    expect(cssText).toContain('--fs-xs:');
    expect(cssText).toContain('--fs-sm:');
    expect(cssText).toContain('--fs-base:');
    expect(cssText).toContain('--fs-md:');
    expect(cssText).toContain('--fs-lg:');
    expect(cssText).toContain('--fs-xl:');
    expect(cssText).toContain('--fs-xxl:');
    expect(cssText).toContain('--fs-huge:');
    expect(cssText).toContain('--fs-display:');
  });

  it('should define --fs-scale multiplier with default value of 1', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/base.css', 'utf8')
    );
    
    expect(cssText).toContain('--fs-scale:');
    // The default should be 1
    expect(cssText).toMatch(/--fs-scale:\s*1/);
  });

  it('should apply font sizes using calc() with scale multiplier', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/base.css', 'utf8')
    );
    
    // Font size variables should use calc() to apply the scale
    expect(cssText).toMatch(/--fs-xs:\s*calc\(/);
    expect(cssText).toMatch(/--fs-sm:\s*calc\(/);
    expect(cssText).toMatch(/--fs-base:\s*calc\(/);
  });
});

describe('Font Size Variable Usage', () => {
  it('should replace hardcoded px values with CSS variables in agents.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/agents.css', 'utf8')
    );
    
    // Should use CSS variables instead of hardcoded px values
    // Check that font-size declarations use var(--fs-*)
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    
    // Should not contain hardcoded px values for font-size
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in sessions.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/sessions.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in cron.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/cron.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in system.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/system.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in models.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/models.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in activity.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/activity.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in header.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/header.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in panels.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/panels.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in spawn.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/spawn.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });

  it('should replace hardcoded px values with CSS variables in a11y.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/a11y.css', 'utf8')
    );
    
    expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
    expect(cssText).not.toMatch(/font-size:\s*\d+px/);
  });
});

describe('Font Size Hierarchy', () => {
  it('should maintain correct relative sizing between font size variables', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/styles/base.css', 'utf8')
    );
    
    // Extract font size values
    const extractValue = (varName) => {
      const match = cssText.match(new RegExp(`--${varName}:\\s*calc\\(\\s*(\\d+)px\\s*\\*\\s*var\\(--fs-scale\\)`));
      return match ? parseInt(match[1]) : null;
    };
    
    const xs = extractValue('fs-xs');
    const sm = extractValue('fs-sm');
    const base = extractValue('fs-base');
    const md = extractValue('fs-md');
    const lg = extractValue('fs-lg');
    const xl = extractValue('fs-xl');
    
    // Verify hierarchy
    expect(xs).toBeLessThan(sm);
    expect(sm).toBeLessThan(base);
    expect(base).toBeLessThan(md);
    expect(md).toBeLessThan(lg);
    expect(lg).toBeLessThan(xl);
  });
});

describe('Chat Pane Font Sizes', () => {
  it('should replace hardcoded px values with CSS variables in chat-pane.css', async () => {
    const cssText = await import('fs').then(fs => 
      fs.promises.readFile('./public/chat-pane.css', 'utf8')
    );
    
    // This file might not have font-size declarations, so check if it exists first
    if (cssText.includes('font-size')) {
      expect(cssText).toMatch(/font-size:\s*var\(--fs-/);
      expect(cssText).not.toMatch(/font-size:\s*\d+px/);
    }
  });
});

describe('No Hardcoded Font Sizes', () => {
  it('should have no hardcoded px font-size values in any CSS file', async () => {
    const fs = await import('fs');
    const path = await import('path');
    
    const cssFiles = [
      'public/styles/base.css',
      'public/styles/main.css',
      'public/styles/header.css',
      'public/styles/panels.css',
      'public/styles/agents.css',
      'public/styles/sessions.css',
      'public/styles/cron.css',
      'public/styles/system.css',
      'public/styles/models.css',
      'public/styles/activity.css',
      'public/styles/session-tree.css',
      'public/styles/spawn.css',
      'public/styles/toast.css',
      'public/styles/a11y.css',
      'public/chat-pane.css',
      'public/noscript.css'
    ];
    
    for (const file of cssFiles) {
      try {
        const cssText = await fs.promises.readFile(file, 'utf8');
        // Skip base.css as it defines the variables with px values
        if (file.includes('base.css')) continue;
        
        const hasHardcoded = /font-size:\s*\d+px/.test(cssText);
        expect(hasHardcoded).toBe(false);
      } catch (err) {
        // File might not exist, skip it
        if (err.code !== 'ENOENT') throw err;
      }
    }
  });
});
