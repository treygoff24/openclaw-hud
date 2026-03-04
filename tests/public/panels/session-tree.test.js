// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

document.body.innerHTML = `
  <span id="tree-count"></span>
  <div id="tree-body"></div>
`;
window.HUD = window.HUD || {};
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};
// Mock makeFocusable for keyboard accessibility
window.makeFocusable = function (el, handler) {
  el.tabIndex = 0;
  el.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handler();
    }
  });
};

await import("../../../public/utils.js");
await import("../../../public/session-labels.js");
await import("../../../public/panels/session-tree.js");

describe("sessionTree.render", () => {
  beforeEach(() => {
    document.getElementById("tree-body").innerHTML = "";
    document.getElementById("tree-count").textContent = "";
  });

  it("renders tree count", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "k1",
        sessionKey: "agent:a:k1",
        agentId: "a",
        sessionId: "s1",
        status: "active",
        updatedAt: now,
        label: "test",
      },
    ]);
    expect(document.getElementById("tree-count").textContent).toBe("1");
  });

  it("renders tree nodes with labels", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "k1",
        sessionKey: "agent:a:k1",
        agentId: "a",
        sessionId: "s1",
        status: "active",
        updatedAt: now,
        label: "my-session",
        model: "gpt-4",
      },
    ]);
    expect(document.querySelector(".tree-label").textContent).toBe("Main · gpt-4 · my-session");
    expect(document.querySelector(".tree-agent").textContent).toBe("a");
  });

  it("renders parent-child relationships", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent",
        sessionKey: "agent:a:parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "Parent",
      },
      {
        key: "child",
        sessionKey: "agent:a:child",
        agentId: "a",
        sessionId: "c",
        status: "active",
        updatedAt: now,
        label: "Child",
        spawnedBy: "parent",
      },
    ]);
    expect(document.querySelectorAll(".tree-node").length).toBe(2);
    const children = document.querySelectorAll(".tree-children .tree-node");
    expect(children.length).toBe(1);
  });

  it("renders empty array", () => {
    HUD.sessionTree.render([]);
    expect(document.getElementById("tree-count").textContent).toBe("0");
  });

  it("uses correct status dot classes", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "k1",
        sessionKey: "agent:a:k1",
        agentId: "a",
        sessionId: "s",
        status: "active",
        updatedAt: now,
      },
    ]);
    expect(document.querySelector(".status-dot-green")).not.toBeNull();
  });

  it("throws explicitly when sessionKey is missing", () => {
    const now = Date.now();
    expect(() => {
      HUD.sessionTree.render([
        { key: "k1", agentId: "a", sessionId: "s", status: "active", updatedAt: now },
      ]);
    }).toThrow("sessionTree.render requires canonical sessionKey for each node");
  });

  it("builds normalized labels with role and alias fallback when metadata is sparse", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "agent:test:subagent:research-task",
        sessionKey: "agent:test:subagent:research-task",
        agentId: "test",
        sessionId: "s-subagent-research-task",
        status: "active",
        updatedAt: now,
        spawnDepth: 1,
        spawnedBy: "agent:test:main",
      },
    ]);
    expect(document.querySelector(".tree-label").textContent).toBe(
      "Subagent · unknown model · research-task",
    );
  });

  it("does not render toggles for leaf nodes", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent",
        sessionKey: "agent:a:parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "Parent",
      },
      {
        key: "leaf",
        sessionKey: "agent:a:leaf",
        agentId: "a",
        sessionId: "l",
        status: "active",
        updatedAt: now,
        label: "Leaf",
        spawnedBy: "parent",
      },
    ]);

    const parentToggle = document.querySelector('.tree-toggle[data-toggle-key="parent"]');
    const leafNodeContent = document.querySelector(
      '.tree-node-content[data-tree-key="leaf"]',
    );
    expect(parentToggle).not.toBeNull();
    expect(leafNodeContent.querySelector(".tree-toggle")).toBeNull();
  });

  it("keeps full slug in tooltip and aria context", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "agent:test:main",
        sessionKey: "agent:test:main",
        agentId: "test",
        sessionId: "main",
        status: "active",
        updatedAt: now,
        label: "main",
        model: "claude-3-5",
      },
    ]);
    const node = document.querySelector(".tree-node-content");
    expect(node.getAttribute("title")).toContain("agent:test:main");
    expect(node.getAttribute("aria-label")).toContain("agent:test:main");
  });
});

describe("sessionTree.toggleNode", () => {
  it("collapses and expands nodes", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent",
        sessionKey: "agent:a:parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "Parent",
      },
      {
        key: "child",
        sessionKey: "agent:a:child",
        agentId: "a",
        sessionId: "c",
        status: "active",
        updatedAt: now,
        label: "Child",
        spawnedBy: "parent",
      },
    ]);
    // Toggle collapse
    HUD.sessionTree.toggleNode("parent");
    expect(document.querySelector(".tree-children.collapsed")).not.toBeNull();
    // Toggle expand
    HUD.sessionTree.toggleNode("parent");
    expect(document.querySelector(".tree-children.collapsed")).toBeNull();
  });

  it("does not rebuild untouched nodes or trigger full re-render work", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent-a",
        sessionKey: "agent:a:parent-a",
        agentId: "a",
        sessionId: "a-parent",
        status: "active",
        updatedAt: now,
        label: "Parent A",
      },
      {
        key: "parent-b",
        sessionKey: "agent:b:parent-b",
        agentId: "b",
        sessionId: "b-parent",
        status: "active",
        updatedAt: now,
        label: "Parent B",
      },
      {
        key: "child-a",
        sessionKey: "agent:a:child-a",
        agentId: "a",
        sessionId: "a-child",
        status: "active",
        updatedAt: now,
        label: "Child A",
        spawnedBy: "parent-a",
      },
      {
        key: "child-b",
        sessionKey: "agent:b:child-b",
        agentId: "b",
        sessionId: "b-child",
        status: "active",
        updatedAt: now,
        label: "Child B",
        spawnedBy: "parent-b",
      },
    ]);

    const untouchedNode = document.querySelector(
      '.tree-node-content[data-tree-key="child-b"]',
    );
    const focusedToggle = document.querySelector(
      '.tree-toggle[data-toggle-key="parent-a"]',
    );
    const timeAgoSpy = vi.spyOn(HUD.utils, "timeAgo");
    timeAgoSpy.mockClear();

    focusedToggle.focus();
    HUD.sessionTree.toggleNode("parent-a");

    expect(document.activeElement).toBe(focusedToggle);
    expect(document.querySelector('.tree-node-content[data-tree-key="child-b"]')).toBe(
      untouchedNode,
    );
    expect(timeAgoSpy).not.toHaveBeenCalled();

    expect(
      document.querySelector('.tree-toggle[data-toggle-key="parent-a"]').getAttribute("aria-expanded"),
    ).toBe("false");
    expect(document.querySelector('.tree-toggle[data-toggle-key="parent-a"]').textContent).toBe("▸");
    const parentNode = document
      .querySelector('.tree-node-content[data-tree-key="parent-a"]')
      .closest(".tree-node");
    expect(parentNode.getAttribute("aria-expanded")).toBe("false");

    timeAgoSpy.mockRestore();
  });

  it("skips collapsed nodes during ArrowDown navigation", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent",
        sessionKey: "agent:a:parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "Parent",
      },
      {
        key: "child",
        sessionKey: "agent:a:child",
        agentId: "a",
        sessionId: "c",
        status: "active",
        updatedAt: now,
        label: "Child",
        spawnedBy: "parent",
      },
      {
        key: "sibling",
        sessionKey: "agent:a:sibling",
        agentId: "a",
        sessionId: "s",
        status: "active",
        updatedAt: now,
        label: "Sibling",
      },
    ]);

    HUD.sessionTree.toggleNode("parent");

    const parentContent = document.querySelector('.tree-node-content[data-tree-key="parent"]');
    const siblingContent = document.querySelector('.tree-node-content[data-tree-key="sibling"]');

    parentContent.focus();
    parentContent.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    expect(document.activeElement).toBe(siblingContent);
  });

  it("skips collapsed nodes during End navigation", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "end-parent",
        sessionKey: "agent:a:end-parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "Parent",
      },
      {
        key: "end-child",
        sessionKey: "agent:a:end-child",
        agentId: "a",
        sessionId: "c",
        status: "active",
        updatedAt: now,
        label: "Child",
        spawnedBy: "end-parent",
      },
    ]);

    HUD.sessionTree.toggleNode("end-parent");

    const parentContent = document.querySelector('.tree-node-content[data-tree-key="end-parent"]');
    const childContent = document.querySelector('.tree-node-content[data-tree-key="end-child"]');

    parentContent.focus();
    parentContent.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));

    expect(document.activeElement).toBe(parentContent);
    expect(document.activeElement).not.toBe(childContent);
  });

  it("uses aria-expanded toggle semantics for ArrowRight regardless of toggle glyph", () => {
    const now = Date.now();
    HUD.sessionTree.render([
      {
        key: "parent",
        sessionKey: "agent:a:parent",
        agentId: "a",
        sessionId: "p",
        status: "active",
        updatedAt: now,
        label: "Parent",
      },
      {
        key: "child",
        sessionKey: "agent:a:child",
        agentId: "a",
        sessionId: "c",
        status: "active",
        updatedAt: now,
        label: "Child",
        spawnedBy: "parent",
      },
    ]);

    const toggle = document.querySelector('.tree-toggle[data-toggle-key="parent"]');
    if (toggle.getAttribute("aria-expanded") === "false") {
      HUD.sessionTree.toggleNode("parent");
    }

    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    HUD.sessionTree.toggleNode("parent");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.textContent = "★";

    const parentContent = document.querySelector('.tree-node-content[data-tree-key="parent"]');
    parentContent.focus();
    parentContent.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
