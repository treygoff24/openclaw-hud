(function () {
  "use strict";

  window.ChatCommandsModules = window.ChatCommandsModules || {};

  const modules = window.ChatCommandsModules;
  const catalog = modules.catalog;
  const fuzzy = modules.fuzzy;

  function getAll() {
    return catalog.commands.slice();
  }

  function find(input) {
    if (!input || input.length < 1) return null;

    input = input.toLowerCase().replace(/^\//, "");

    let bestMatch = null;
    let bestScore = 0;

    for (const cmd of catalog.commands) {
      let score = fuzzy.getFuzzyScore(input, cmd.name);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = cmd;
      }

      for (const alias of cmd.aliases) {
        score = fuzzy.getFuzzyScore(input, alias);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = cmd;
        }
      }
    }

    const threshold = input.length <= 4 ? 0.5 : 0.6;
    return bestScore > threshold ? bestMatch : null;
  }

  function search(input) {
    if (!input || input.length < 1) return getAll();

    input = input.toLowerCase().replace(/^\//, "");

    const results = [];
    for (const cmd of catalog.commands) {
      let maxScore = 0;

      maxScore = Math.max(maxScore, fuzzy.getFuzzyScore(input, cmd.name));

      for (const alias of cmd.aliases) {
        maxScore = Math.max(maxScore, fuzzy.getFuzzyScore(input, alias));
      }

      const descWords = cmd.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.includes(input)) {
          maxScore = Math.max(maxScore, 0.3);
        }
      }

      if (maxScore > 0.5) {
        results.push({ command: cmd, score: maxScore });
      }
    }

    results.sort(function (a, b) {
      return b.score - a.score;
    });
    return results.map(function (r) {
      return r.command;
    });
  }

  function parse(input) {
    if (!input || !input.startsWith("/")) {
      return { isCommand: false, command: null, args: "" };
    }

    const trimmed = input.slice(1).trim();
    const firstSpace = trimmed.indexOf(" ");

    let command;
    let args;
    if (firstSpace === -1) {
      command = trimmed;
      args = "";
    } else {
      command = trimmed.substring(0, firstSpace);
      args = trimmed.substring(firstSpace + 1).trim();
    }

    return { isCommand: true, command: command, args: args, original: input };
  }

  window.ChatCommandsModules.registry = {
    getAll: getAll,
    find: find,
    search: search,
    parse: parse,
  };
})();
