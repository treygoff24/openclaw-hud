// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

document.body.innerHTML = '<span id="session-count"></span><div id="sessions-list"></div>';
window.HUD = window.HUD || {};
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

window.morphdom = function (current, next) {
  const existing = Array.from(current.children);
  const incoming = Array.from(next.children);
  const sharedCount = Math.min(existing.length, incoming.length);

  for (let i = 0; i < sharedCount; i++) {
    const target = existing[i];
    const source = incoming[i];
    const sourceAttrs = Array.from(source.attributes);
    const sourceAttrNames = new Set(sourceAttrs.map((attr) => attr.name));

    sourceAttrs.forEach((attr) => target.setAttribute(attr.name, attr.value));
    Array.from(target.attributes).forEach((attr) => {
      if (!sourceAttrNames.has(attr.name)) {
        target.removeAttribute(attr.name);
      }
    });
    target.innerHTML = source.innerHTML;
  }

  if (incoming.length > existing.length) {
    for (let i = sharedCount; i < incoming.length; i++) {
      current.appendChild(incoming[i]);
    }
  } else if (existing.length > incoming.length) {
    for (let i = existing.length - 1; i >= incoming.length; i--) {
      current.removeChild(existing[i]);
    }
  }
};

// Use real focus helper implementation for keyboard behavior
await import("../../../public/a11y/focus-trap.js");

// Load utils for HUD.utils.timeAgo
await import("../../../public/utils.js");
await import("../../../public/session-labels.js");
await import("../../../public/panels/sessions.js");

describe("sessions.render", () => {
  beforeEach(() => {
    document.getElementById("session-count").textContent = "";
    document.getElementById("sessions-list").innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders session count", () => {
    HUD.sessions.render([
      {
        agentId: "a",
        sessionId: "s1",
        sessionKey: "agent:a:s1",
        status: "active",
        updatedAt: Date.now(),
      },
    ]);
    expect(document.getElementById("session-count").textContent).toBe("1");
  });

  it("renders session rows with correct structure", () => {
    HUD.sessions.render([
      {
        agentId: "bot",
        sessionId: "abc12345xyz",
        sessionKey: "agent:bot:abc12345xyz",
        label: "my-session",
        model: "gpt-4",
        status: "active",
        updatedAt: Date.now() - 5000,
      },
    ]);
    const rows = document.querySelectorAll(".session-row");
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector(".session-agent").textContent).toBe("bot");
    expect(rows[0].querySelector(".session-label").textContent).toBe("Main · gpt-4 · my-session");
    expect(rows[0].querySelector(".status-dot-green")).not.toBeNull();
  });

  it("uses correct status dot classes", () => {
    const statuses = [
      { status: "active", expected: "status-dot-green" },
      { status: "completed", expected: "status-dot-completed" },
      { status: "warm", expected: "status-dot-amber" },
      { status: "stale", expected: "status-dot-gray" },
      { status: "unknown", expected: "status-dot-gray" },
    ];
    statuses.forEach(({ status, expected }) => {
      HUD.sessions.render([
        {
          agentId: "a",
          sessionId: "s",
          sessionKey: `agent:a:s-${status}`,
          status,
          updatedAt: Date.now(),
        },
      ]);
      expect(document.querySelector(`.${expected}`)).not.toBeNull();
    });
  });

  it("shows normalized subagent role label", () => {
    HUD.sessions.render([
      {
        key: "agent:a:subagent-task",
        agentId: "a",
        sessionId: "s",
        sessionKey: "agent:a:subagent-task",
        model: "claude",
        spawnDepth: 2,
        updatedAt: Date.now(),
      },
    ]);
    expect(document.querySelector(".session-label").textContent).toBe(
      "Subagent · claude · subagent-task",
    );
  });

  it("renders empty array", () => {
    HUD.sessions.render([]);
    expect(document.getElementById("session-count").textContent).toBe("0");
  });

  it("handles null input without throwing and reports zero count", () => {
    expect(() => HUD.sessions.render(null)).not.toThrow();
    expect(document.getElementById("session-count").textContent).toBe("0");
  });

  it("caps at 40 rows", () => {
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      agentId: "a",
      sessionId: `s${i}`,
      sessionKey: `agent:a:s${i}`,
      status: "active",
      updatedAt: Date.now(),
    }));
    HUD.sessions.render(sessions);
    expect(document.getElementById("session-count").textContent).toBe("50");
    expect(document.querySelectorAll(".session-row").length).toBe(40);
  });

  it("sets data attributes on session rows", () => {
    HUD.sessions.render([
      {
        agentId: "bot",
        sessionId: "xyz",
        sessionKey: "agent:bot:xyz",
        label: "lbl",
        model: "o1",
        status: "active",
        updatedAt: Date.now(),
      },
    ]);
    const row = document.querySelector(".session-row");
    expect(row.dataset.agent).toBe("bot");
    expect(row.dataset.session).toBe("xyz");
    expect(row.dataset.sessionKey).toBe("agent:bot:xyz");
  });

  it("uses full session slug in aria label and title for context", () => {
    HUD.sessions.render([
      {
        agentId: "bot",
        sessionId: "xyz",
        sessionKey: "agent:bot:xyz",
        label: "lbl",
        model: "o1",
        status: "active",
        updatedAt: Date.now(),
      },
    ]);
    const row = document.querySelector(".session-row");
    expect(row.getAttribute("title")).toContain("agent:bot:xyz");
    expect(row.getAttribute("aria-label")).toContain("agent:bot:xyz");
  });

  it("falls back cleanly when model metadata is missing", () => {
    HUD.sessions.render([
      {
        agentId: "a",
        sessionId: "s-missing",
        sessionKey: "agent:a:s-missing",
        status: "active",
        updatedAt: Date.now(),
      },
    ]);
    expect(document.querySelector(".session-label").textContent).toBe(
      "Main · unknown model · s-missing",
    );
  });

  it("throws explicitly when sessionKey is missing", () => {
    expect(() => {
      HUD.sessions.render([
        { agentId: "bot", sessionId: "xyz", label: "lbl", status: "active", updatedAt: Date.now() },
      ]);
    }).toThrow("sessions.render requires canonical sessionKey for each session");
  });

  it("does not stack makeFocusable listeners on rerender", () => {
    HUD.sessions.render([
      {
        agentId: "bot",
        sessionId: "s1",
        sessionKey: "agent:bot:s1",
        status: "active",
        updatedAt: Date.now(),
      },
    ]);

    const row = document.querySelector(".session-row");
    const addListenerSpy = vi.spyOn(row, "addEventListener");

    HUD.sessions.render([
      {
        agentId: "bot",
        sessionId: "s1",
        sessionKey: "agent:bot:s1",
        status: "active",
        updatedAt: Date.now(),
      },
    ]);

    const keydownCalls = addListenerSpy.mock.calls.filter((call) => call[0] === "keydown").length;
    const focusCalls = addListenerSpy.mock.calls.filter((call) => call[0] === "focus").length;
    const blurCalls = addListenerSpy.mock.calls.filter((call) => call[0] === "blur").length;

    expect(keydownCalls).toBe(0);
    expect(focusCalls).toBe(0);
    expect(blurCalls).toBe(0);
  });
});
