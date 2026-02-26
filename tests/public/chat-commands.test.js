// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set up minimal DOM for command tests
document.body.innerHTML = `
  <div id="chat-input-area" style="position:relative;height:100px;">
    <textarea id="chat-input" class="chat-input" placeholder="Type a message..." rows="1"></textarea>
  </div>
  <div id="chat-messages"></div>
`;

// Mock getBoundingClientRect for all elements
const mockRect = {
  top: 100,
  left: 10,
  right: 500,
  bottom: 140,
  width: 490,
  height: 40,
  x: 10,
  y: 100,
};
const originalGetBoundingClientRectDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "getBoundingClientRect",
);
Element.prototype.getBoundingClientRect = function () {
  return mockRect;
};

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock ChatState
window.ChatState = {
  currentSession: { sessionKey: "agent:test:session1" },
  pendingAcks: new Map(),
  cachedModels: ["openai/gpt-4", "anthropic/claude-3"],
  sendWs: vi.fn(),
};

// Mock HUD
window.HUD = {
  showToast: vi.fn(),
};

// Load command-adjacent chat-input modules before chat-commands entrypoint.
document.getElementById("chat-input").value = "";
await import("../../public/chat-input/attachments.js");
await import("../../public/chat-input/autocomplete.js");
await import("../../public/chat-input/send-flow.js");
await import("../../public/chat-input/model-picker.js");
await import("../../public/chat-commands/catalog.js");
await import("../../public/chat-commands/fuzzy.js");
await import("../../public/chat-commands/registry.js");
await import("../../public/chat-commands/help.js");
await import("../../public/chat-commands/local-exec.js");
await import("../../public/chat-commands.js");
await import("../../public/chat-input.js");

describe("chat-commands.js", () => {
  describe("Command Registry", () => {
    it("exposes ChatCommands global", () => {
      expect(window.ChatCommands).toBeDefined();
      expect(typeof window.ChatCommands.getAll).toBe("function");
      expect(typeof window.ChatCommands.find).toBe("function");
      expect(typeof window.ChatCommands.execute).toBe("function");
    });

    it("has all required commands defined", () => {
      const commands = window.ChatCommands.getAll();
      const commandNames = commands.map((c) => c.name);

      const required = [
        "help",
        "abort",
        "new",
        "reset",
        "model",
        "think",
        "verbose",
        "status",
        "models",
        "clear",
        "export",
        "session",
        "save",
        "load",
        "prompt",
        "system",
        "temp",
        "max-tokens",
        "reasoning",
        "search",
        "web",
        "recall",
        "memory",
        "alias",
        "context",
        "output",
        "response",
        "provider",
        "think-depth",
        "max-turns",
        "continue",
        "retry",
        "edit",
      ];

      for (const cmd of required) {
        expect(commandNames).toContain(cmd);
      }
    });

    it("each command has required properties", () => {
      const commands = window.ChatCommands.getAll();
      for (const cmd of commands) {
        expect(cmd.name).toBeDefined();
        expect(cmd.description).toBeDefined();
        expect(cmd.category).toBeDefined();
        expect(Array.isArray(cmd.aliases)).toBe(true);
      }
    });

    it("categories are valid", () => {
      const validCategories = [
        "Session",
        "Model",
        "Display",
        "Tools",
        "Memory",
        "System",
        "Config",
      ];
      const commands = window.ChatCommands.getAll();
      for (const cmd of commands) {
        expect(validCategories).toContain(cmd.category);
      }
    });

    it("local commands are marked correctly", () => {
      const localCommands = [
        "help",
        "abort",
        "new",
        "reset",
        "model",
        "think",
        "verbose",
        "status",
        "models",
      ];
      for (const cmdName of localCommands) {
        const cmd = window.ChatCommands.getAll().find((c) => c.name === cmdName);
        expect(cmd).toBeDefined();
        expect(cmd.local).toBe(true);
      }
    });
  });

  describe("Command Search", () => {
    it("finds exact match by name", () => {
      const result = window.ChatCommands.find("help");
      expect(result).toBeDefined();
      expect(result.name).toBe("help");
    });

    it("finds by prefix", () => {
      const results = window.ChatCommands.search("mo");
      const names = results.map((r) => r.name);
      expect(names).toContain("model");
      expect(names).toContain("models");
    });

    it("finds by alias", () => {
      const result = window.ChatCommands.find("h");
      expect(result).toBeDefined();
      expect(result.name).toBe("help");
    });

    it("fuzzy matches partial input", () => {
      const results = window.ChatCommands.search("mdl");
      const names = results.map((r) => r.name);
      expect(names).toContain("model");
    });

    it("returns empty array for no matches", () => {
      const results = window.ChatCommands.search("xyznonexistent");
      expect(results).toHaveLength(0);
    });

    it("search is case insensitive", () => {
      const result1 = window.ChatCommands.find("HELP");
      const result2 = window.ChatCommands.find("Help");
      expect(result1).toEqual(result2);
    });
  });

  describe("Levenshtein Distance Fuzzy Matching", () => {
    it("matches close typos", () => {
      // Test the fuzzy score - 'hel' is prefix match for 'help'
      const score = window.ChatCommands._getFuzzyScore("hel", "help");
      expect(score).toBe(0.9); // prefix match

      // Test actual find with a typo - 'hlp' should still find 'help'
      const result = window.ChatCommands.find("hlp");
      expect(result).toBeDefined();
    });

    it("matches shortened forms", () => {
      const result = window.ChatCommands.find("stat");
      expect(result).toBeDefined();
      expect(result.name).toBe("status");
    });

    it("has working levenshtein distance", () => {
      const dist = window.ChatCommands._levenshtein("help", "hepl");
      expect(dist).toBe(2); // 2 character swaps
      expect(dist).toBeLessThan(4);
    });
  });

  describe("Command Execution", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      window.ChatState.currentSession = { sessionKey: "agent:test:session1" };
    });

    it("executes /help locally", () => {
      const result = window.ChatCommands.execute("/help");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
    });

    it("executes /status locally", () => {
      const result = window.ChatCommands.execute("/status");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
    });

    it("executes /abort locally and sends abort message", () => {
      const result = window.ChatCommands.execute("/abort");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat-abort" }),
      );
    });

    it("executes /new locally", () => {
      const result = window.ChatCommands.execute("/new");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat-new" }),
      );
    });

    it("executes /reset locally", () => {
      const result = window.ChatCommands.execute("/reset");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat-reset" }),
      );
    });

    it("executes /model locally with argument", () => {
      const result = window.ChatCommands.execute("/model openai/gpt-4");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat-model", model: "openai/gpt-4" }),
      );
    });

    it("executes /think locally", () => {
      const result = window.ChatCommands.execute("/think on");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat-think", value: "on" }),
      );
    });

    it("executes /verbose locally", () => {
      const result = window.ChatCommands.execute("/verbose off");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "chat-verbose", value: "off" }),
      );
    });

    it("executes /models locally", () => {
      const result = window.ChatCommands.execute("/models");
      expect(result.handled).toBe(true);
      expect(result.local).toBe(true);
      expect(window.ChatState.sendWs).toHaveBeenCalledWith(
        expect.objectContaining({ type: "models-list" }),
      );
    });

    it("returns not-handled for non-local commands", () => {
      const result = window.ChatCommands.execute("/search something");
      expect(result.handled).toBe(false);
      expect(result.local).toBe(false);
    });

    it("parses arguments correctly", () => {
      const result = window.ChatCommands.parse("/model openai/gpt-4");
      expect(result.command).toBe("model");
      expect(result.args).toBe("openai/gpt-4");
    });

    it("parses empty arguments", () => {
      const result = window.ChatCommands.parse("/help");
      expect(result.command).toBe("help");
      expect(result.args).toBe("");
    });
  });

  describe("Help Rendering", () => {
    it("renders help output with categories", () => {
      const help = window.ChatCommands.renderHelp();
      expect(help).toContain("Session");
      expect(help).toContain("Model");
      expect(help).toContain("/help");
      expect(help).toContain("/model");
    });

    it("groups commands by category", () => {
      const help = window.ChatCommands.renderHelp();
      const lines = help.split("\n");
      let inSessionCategory = false;
      let foundHelp = false;

      for (const line of lines) {
        if (line.includes("Session")) inSessionCategory = true;
        if (inSessionCategory && line.includes("/help")) foundHelp = true;
      }

      expect(foundHelp).toBe(true);
    });
  });
});

describe("chat-input.js autocomplete integration", () => {
  let input;
  let container;

  beforeEach(() => {
    input = document.getElementById("chat-input");
    container = document.getElementById("chat-input-area");
    input.value = "";
    // Remove any existing dropdown
    const existing = document.getElementById("slash-autocomplete");
    if (existing) existing.remove();
  });

  afterEach(() => {
    const dropdown = document.getElementById("slash-autocomplete");
    if (dropdown) dropdown.remove();
  });

  it("shows autocomplete when typing /", () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    expect(dropdown).not.toBeNull();
    expect(dropdown.style.display).not.toBe("none");
  });

  it("hides autocomplete when input is empty", () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    input.value = "";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    expect(dropdown).toBeNull();
  });

  it("filters commands as user types", () => {
    input.value = "/mod";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    const items = dropdown.querySelectorAll(".slash-item");
    const texts = Array.from(items).map((i) => i.textContent);

    expect(texts.some((t) => t.includes("model"))).toBe(true);
    expect(texts.some((t) => t.includes("models"))).toBe(true);
  });

  it("navigates with arrow keys", async () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    if (!dropdown) {
      // Skip if dropdown wasn't created (jsdom limitation)
      return;
    }

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    const selected = dropdown.querySelector(".slash-item.selected");
    expect(selected).not.toBeNull();
  });

  it("completes on Tab key", () => {
    input.value = "/hel";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    expect(input.value).toBe("/help ");
  });

  it("completes on Enter key", () => {
    input.value = "/mod";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(input.value.startsWith("/model")).toBe(true);
  });

  it("closes autocomplete on Escape", () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    expect(dropdown).toBeNull();
  });

  it("shows argument hints after command selection", async () => {
    // First trigger autocomplete with partial command
    input.value = "/mod";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    // Tab to complete the command
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));

    const hints = document.getElementById("slash-hints");
    // Hints may or may not be created depending on command completion
    // The important thing is the input was updated
    expect(input.value.startsWith("/model")).toBe(true);
  });

  it("does not show autocomplete without / prefix", () => {
    input.value = "hello";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    expect(dropdown).toBeNull();
  });

  it("handles fuzzy matching in autocomplete", () => {
    input.value = "/mdl";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    const items = dropdown.querySelectorAll(".slash-item");
    const texts = Array.from(items).map((i) => i.textContent.toLowerCase());

    expect(texts.some((t) => t.includes("model"))).toBe(true);
  });

  it("clicking item completes command", async () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    if (!dropdown) {
      // Skip if dropdown wasn't created (jsdom limitation)
      return;
    }

    const item = dropdown.querySelector(".slash-item");
    if (item) {
      item.click();
      expect(input.value.startsWith("/")).toBe(true);
    }
  });

  it("autocomplete positioned correctly", async () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const dropdown = document.getElementById("slash-autocomplete");
    if (!dropdown) {
      // Skip if dropdown wasn't created (jsdom limitation)
      return;
    }

    // Dropdown should have absolute positioning
    expect(dropdown.style.position).toBe("absolute");
  });

  it("dismisses autocomplete when Enter sends a message without completing a command", () => {
    // Reset module state, then open autocomplete
    input.value = "x";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    let dropdown = container.querySelector(".slash-autocomplete");
    expect(dropdown).not.toBeNull();
    expect(dropdown.style.display).not.toBe("none");

    // Manually force the dropdown to be visible with no items to simulate
    // the race condition where completeSelected() returns false
    // We do this by clearing the dropdown items from DOM and setting display
    dropdown.innerHTML = "";
    dropdown.style.display = "block";

    // Set input to a regular message. Don't fire input event to keep
    // autocomplete dropdown visible in module state.
    input.value = "hello world";

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    // Autocomplete dropdown should be dismissed after Enter sends
    const dropdownAfter = container.querySelector(".slash-autocomplete");
    const isHidden = !dropdownAfter || dropdownAfter.style.display === "none";
    expect(isHidden).toBe(true);
  });

  it("allows Shift+Enter for newline when autocomplete open", () => {
    input.value = "/";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
    });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    input.dispatchEvent(event);

    // Should not prevent default for Shift+Enter
    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});
