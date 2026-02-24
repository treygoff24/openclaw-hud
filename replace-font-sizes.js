#!/usr/bin/env node
/**
 * Script to replace hardcoded font-size px values with CSS variables
 */

const fs = require('fs');
const path = require('path');

const cssFiles = [
  'public/styles/agents.css',
  'public/styles/sessions.css',
  'public/styles/cron.css',
  'public/styles/system.css',
  'public/styles/models.css',
  'public/styles/activity.css',
  'public/styles/header.css',
  'public/styles/panels.css',
  'public/styles/spawn.css',
  'public/styles/a11y.css',
  'public/styles/tree.css',
  'public/styles/toast.css',
  'public/chat-pane.css',
  'public/noscript.css'
];

// Font size mapping
const fontSizeMap = {
  '9px': 'var(--fs-xs)',
  '10px': 'var(--fs-sm)',
  '11px': 'var(--fs-base)',
  '12px': 'var(--fs-md)',
  '13px': 'var(--fs-lg)',
  '14px': 'var(--fs-xl)',
  '15px': 'var(--fs-xxl)',
  '16px': 'var(--fs-huge)',
  '18px': 'var(--fs-display)',
  '20px': 'calc(20px * var(--fs-scale))',
  '22px': 'calc(22px * var(--fs-scale))',
  '24px': 'calc(24px * var(--fs-scale))'
};

let totalReplacements = 0;

cssFiles.forEach(filePath => {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let fileReplacements = 0;
    
    // Replace each font-size value
    Object.entries(fontSizeMap).forEach(([pxValue, cssVar]) => {
      const regex = new RegExp(`font-size:\\s*${pxValue}`, 'g');
      const matches = content.match(regex);
      if (matches) {
        fileReplacements += matches.length;
        content = content.replace(regex, `font-size: ${cssVar}`);
      }
    });
    
    if (fileReplacements > 0) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✓ ${filePath}: ${fileReplacements} replacements`);
      totalReplacements += fileReplacements;
    } else {
      console.log(`  ${filePath}: no changes`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`✗ Error processing ${filePath}:`, err.message);
    }
  }
});

console.log(`\n✅ Total replacements: ${totalReplacements}`);
