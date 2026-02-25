(function () {
  "use strict";

  window.ChatCommandsModules = window.ChatCommandsModules || {};

  const modules = window.ChatCommandsModules;
  const registry = modules.registry;
  const localExec = modules.localExec;
  const help = modules.help;
  const fuzzy = modules.fuzzy;

  if (!registry || !localExec || !help || !fuzzy) {
    throw new Error(
      "chat-commands modules missing. Load /chat-commands/*.js before /chat-commands.js",
    );
  }

  function parse(input) {
    return registry.parse(input);
  }

  function find(input) {
    return registry.find(input);
  }

  function execute(input) {
    const parsed = parse(input);

    if (!parsed.isCommand) {
      return { handled: false, local: false, result: null };
    }

    const cmd = find(parsed.command);

    if (!cmd) {
      return { handled: false, local: false, result: null, error: "Unknown command" };
    }

    if (cmd.local) {
      return localExec.executeLocal(cmd, parsed.args);
    }

    return { handled: false, local: false, command: cmd, args: parsed.args };
  }

  window.ChatCommands = {
    getAll: registry.getAll,
    find: find,
    search: registry.search,
    parse: parse,
    execute: execute,
    renderHelp: help.renderHelp,
    _levenshtein: fuzzy.levenshteinDistance,
    _getFuzzyScore: fuzzy.getFuzzyScore,
  };
})();
