// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

window.HUDApp = window.HUDApp || {};
await import("../../public/app/ui.js");

function createMockDocument() {
  const handlers = { click: [], keydown: [] };
  return {
    handlers,
    querySelector: () => null,
    addEventListener: (event, handler) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    },
  };
}

describe("HUDApp.ui.createUiController", () => {
  let HUD;
  let doc;

  beforeEach(() => {
    window.openChatPane = undefined;
    HUD = {
      cron: { openEditor: vi.fn() },
      agents: { showAgentSessions: vi.fn() },
      sessionTree: { toggleNode: vi.fn() },
    };
    doc = createMockDocument();
  });

  it("resolves window.openChatPane at click time", () => {
    const controller = window.HUDApp.ui.createUiController({ document: doc, HUD });
    controller.bindDelegationHandlers();

    const row = {
      dataset: {
        agent: "spark",
        session: "session-1",
        label: "Main",
        sessionKey: "agent:spark:session-1",
      },
    };

    const target = {
      closest: (selector) => (selector === "[data-agent][data-session-key]" ? row : null),
    };
    const clickEvent = { target, stopPropagation: vi.fn() };

    const openChatPane = vi.fn();
    window.openChatPane = openChatPane;

    for (const handler of doc.handlers.click) {
      handler(clickEvent);
    }

    expect(openChatPane).toHaveBeenCalledWith(
      "spark",
      "session-1",
      "Main",
      "agent:spark:session-1",
    );
  });

  it("does not throw when chat-pane scripts are not loaded yet", () => {
    const controller = window.HUDApp.ui.createUiController({ document: doc, HUD });
    controller.bindDelegationHandlers();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const row = {
      dataset: {
        agent: "spark",
        session: "session-1",
        label: "Main",
        sessionKey: "agent:spark:session-1",
      },
    };
    const target = {
      closest: (selector) => (selector === "[data-agent][data-session-key]" ? row : null),
    };
    const clickEvent = { target, stopPropagation: vi.fn() };

    expect(() => {
      for (const handler of doc.handlers.click) {
        handler(clickEvent);
      }
    }).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      "openChatPane is unavailable; chat pane scripts may not be loaded yet.",
    );

    warnSpy.mockRestore();
  });
});
