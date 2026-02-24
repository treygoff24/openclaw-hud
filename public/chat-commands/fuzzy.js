(function() {
  'use strict';

  window.ChatCommandsModules = window.ChatCommandsModules || {};

  function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[b.length][a.length];
  }

  function getFuzzyScore(input, target) {
    input = input.toLowerCase();
    target = target.toLowerCase();

    if (target === input) return 1.0;
    if (target.startsWith(input)) return 0.9;
    if (target.includes(input)) return 0.7;

    const maxLen = Math.max(input.length, target.length);
    if (maxLen === 0) return 0;
    const distance = levenshteinDistance(input, target);
    const similarity = 1 - distance / maxLen;

    return similarity > 0.5 ? similarity * 0.6 : 0;
  }

  window.ChatCommandsModules.fuzzy = {
    levenshteinDistance: levenshteinDistance,
    getFuzzyScore: getFuzzyScore
  };
})();
