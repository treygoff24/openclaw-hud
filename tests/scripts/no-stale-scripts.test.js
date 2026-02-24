import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('stale scripts', () => {
  it('replace-font-sizes.js should not exist in project root', () => {
    const scriptPath = path.resolve(__dirname, '../../replace-font-sizes.js');
    expect(fs.existsSync(scriptPath)).toBe(false);
  });
});
