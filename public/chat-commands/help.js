(function () {
  "use strict";

  window.ChatCommandsModules = window.ChatCommandsModules || {};

  const catalog = window.ChatCommandsModules.catalog;

  function renderHelp() {
    const byCategory = {};

    for (const cmd of catalog.commands) {
      if (!byCategory[cmd.category]) {
        byCategory[cmd.category] = [];
      }
      byCategory[cmd.category].push(cmd);
    }

    const lines = [
      "╔══════════════════════════════════════════════════════════════╗",
      "║                    SLASH COMMAND REFERENCE                     ║",
      "╠══════════════════════════════════════════════════════════════╣",
      "",
    ];

    const categoryOrder = [
      catalog.CATEGORIES.SESSION,
      catalog.CATEGORIES.MODEL,
      catalog.CATEGORIES.DISPLAY,
      catalog.CATEGORIES.TOOLS,
      catalog.CATEGORIES.MEMORY,
      catalog.CATEGORIES.SYSTEM,
      catalog.CATEGORIES.CONFIG,
    ];

    for (const cat of categoryOrder) {
      if (!byCategory[cat]) continue;

      lines.push("┌─ " + cat + " ─" + "─".repeat(60 - cat.length) + "┐");
      lines.push("");

      for (const cmd of byCategory[cat]) {
        const aliases = cmd.aliases.length > 0 ? " (" + cmd.aliases.join(", ") + ")" : "";
        lines.push("  /" + cmd.name + aliases);
        lines.push("      " + cmd.description);

        if (cmd.args && cmd.args.length > 0) {
          for (const arg of cmd.args) {
            const required = arg.required ? "*" : "";
            const defaultVal = arg.default ? " [default: " + arg.default + "]" : "";
            const choices = arg.choices ? " [" + arg.choices.join("|") + "]" : "";
            lines.push(
              "      <" + arg.name + required + ">" + choices + defaultVal + ": " + arg.description,
            );
          }
        }
        lines.push("");
      }
    }

    lines.push("└──────────────────────────────────────────────────────────────┘");
    lines.push("");
    lines.push("Tips:");
    lines.push("  • Use Tab to autocomplete commands");
    lines.push("  • Commands marked with * are handled locally");
    lines.push("  • Use /help <command> for detailed help on a specific command");

    return lines.join("\n");
  }

  window.ChatCommandsModules.help = {
    renderHelp: renderHelp,
  };
})();
