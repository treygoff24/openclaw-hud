#!/usr/bin/env node
// Bundle Analyzer Script — Analyzes and optimizes script loading
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

// File size analysis
function analyzeBundle() {
  const files = fs.readdirSync(PUBLIC_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => {
      const fullPath = path.join(PUBLIC_DIR, f);
      const stats = fs.statSync(fullPath);
      return {
        name: f,
        size: stats.size,
        sizeKb: (stats.size / 1024).toFixed(1)
      };
    })
    .sort((a, b) => b.size - a.size);
  
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  
  console.log('\n=== Bundle Analysis ===\n');
  console.log(`Total JS size: ${(totalSize / 1024).toFixed(1)} KB`);
  console.log('\nBreakdown:');
  files.forEach(f => {
    const percent = ((f.size / totalSize) * 100).toFixed(1);
    console.log(`  ${f.name.padEnd(25)} ${f.sizeKb.padStart(6)} KB (${percent}%)`);
  });
  
  return { files, totalSize };
}

// Identify lazy loading candidates
function identifyLazyCandidates() {
  const candidates = [];
  
  // Check for feature modules that could be lazy loaded
  const featureModules = [
    { name: 'chat-progressive-render.js', feature: 'Progressive rendering', trigger: 'Large tool results' },
    { name: 'chat-markdown.js', feature: 'Markdown rendering', trigger: 'Assistant messages' },
  ];
  
  featureModules.forEach(m => {
    const fullPath = path.join(PUBLIC_DIR, m.name);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      candidates.push({
        ...m,
        size: stats.size,
        sizeKb: (stats.size / 1024).toFixed(1)
      });
    }
  });
  
  console.log('\n=== Lazy Loading Candidates ===\n');
  if (candidates.length === 0) {
    console.log('No lazy loading candidates identified.');
  } else {
    candidates.forEach(c => {
      console.log(`  ${c.name}`);
      console.log(`    Size: ${c.sizeKb} KB`);
      console.log(`    Feature: ${c.feature}`);
      console.log(`    Load trigger: ${c.trigger}`);
      console.log();
    });
  }
  
  return candidates;
}

// Check CDN vs local fallback
function checkVendorFiles() {
  const vendorDir = path.join(PUBLIC_DIR, 'vendor');
  
  console.log('=== Vendor File Check ===\n');
  
  const required = [
    { name: 'marked.min.js', cdn: 'https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js' },
    { name: 'purify.min.js', cdn: 'https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js' }
  ];
  
  if (!fs.existsSync(vendorDir)) {
    console.log('  WARNING: vendor/ directory does not exist');
    console.log('  Run `npm run vendor:sync` to download fallback files');
    return { missing: required };
  }
  
  const existing = fs.readdirSync(vendorDir);
  const missing = required.filter(r => !existing.includes(r.name));
  
  if (missing.length === 0) {
    console.log('  ✓ All vendor files present');
    required.forEach(r => {
      const stats = fs.statSync(path.join(vendorDir, r.name));
      console.log(`    ${r.name}: ${(stats.size / 1024).toFixed(1)} KB`);
    });
  } else {
    console.log('  Missing vendor files:');
    missing.forEach(m => console.log(`    - ${m.name}`));
    console.log('  Run `npm run vendor:sync` to download');
  }
  
  return { missing };
}

// Generate optimization recommendations
function generateRecommendations(analysis) {
  console.log('\n=== Recommendations ===\n');
  
  const totalKb = analysis.totalSize / 1024;
  
  if (totalKb > 100) {
    console.log('⚠ Total bundle size exceeds 100KB:');
    console.log('  - Consider lazy loading non-critical modules');
    console.log('  - Implement code splitting for panel modules');
    console.log();
  }
  
  const largeFiles = analysis.files.filter(f => f.size > 10 * 1024); // >10KB
  if (largeFiles.length > 0) {
    console.log('Large files that could benefit from optimization:');
    largeFiles.forEach(f => {
      console.log(`  - ${f.name}: ${f.sizeKb} KB`);
    });
    console.log();
  }
  
  console.log('✓ Bundle analysis complete');
}

// Main execution
function main() {
  console.log('OpenClaw HUD Bundle Analyzer\n');
  
  const analysis = analyzeBundle();
  identifyLazyCandidates();
  checkVendorFiles();
  generateRecommendations(analysis);
  
  // Exit with error code if bundle is too large
  if (analysis.totalSize > 150 * 1024) { // 150KB threshold
    console.log('\n❌ Bundle size exceeds 150KB threshold');
    process.exit(1);
  }
  
  console.log('\n✅ Bundle size OK');
  process.exit(0);
}

// Export for testing
if (require.main === module) {
  main();
} else {
  module.exports = { analyzeBundle, identifyLazyCandidates, checkVendorFiles };
}
