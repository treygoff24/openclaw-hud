// Shared label normalization helpers for display-only formatting.
(function() {
  'use strict';

  function fallbackNormalizeLabel(label, fallback) {
    if (label == null) return fallback || '';
    return String(label);
  }

  function normalizeDisplayLabel(label, fallback) {
    if (label == null) return fallback || '';

    var value = String(label).normalize ? String(label).normalize('NFKC') : String(label);
    if (!value) return fallback || '';

    // Strip ANSI CSI control codes and other control characters often found in noisy outputs.
    value = value.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
    value = value.replace(/[\u0000-\u001f\u007F-\u009F]+/g, ' ');

    // Normalize whitespace and collapse runs.
    value = value.replace(/[\r\n\t]+/g, ' ');
    value = value.replace(/\s+/g, ' ');
    value = value.trim();

    // Remove noisy wrappers and dangling separators.
    value = value
      .replace(/^[\s"'`\(\[\{<]+/g, '')
      .replace(/[\s"'`\)\]\}>]+$/g, '')
      .replace(/^[\-_\\\/|:.;,]+/g, '')
      .replace(/[\-_\\\/|:.;,]+$/g, '')
      .trim();

    var parts = value.split(':').map(function(part) { return part.trim(); }).filter(Boolean);
    if (parts.length > 1) {
      var firstPart = parts[0] || '';
      var remaining = parts[parts.length - 1];
      var allCaps = true;
      for (var i = 0; i < parts.length; i += 1) {
        if (!/^[A-Z0-9_-]+$/.test(parts[i])) {
          allCaps = false;
          break;
        }
      }
      if (/^[A-Z0-9_-]+$/.test(firstPart) || allCaps) {
        value = remaining;
      }
    }

    return value || fallback || '';
  }

  window.HUD = window.HUD || {};
  HUD.labelSanitizer = {
    normalizeLabel: normalizeDisplayLabel,
    normalizeDisplayLabel: normalizeDisplayLabel,
    fallbackNormalizeLabel: fallbackNormalizeLabel
  };
})();
