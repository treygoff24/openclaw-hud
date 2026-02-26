// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

document.body.innerHTML = `
  <span id="cron-count"></span>
  <div id="cron-list"></div>
  <div id="cron-modal" class="modal-overlay">
    <span id="cron-edit-name"></span>
    <input id="cron-name" />
    <input id="cron-enabled" type="checkbox" />
    <select id="cron-agent"></select>
    <select id="cron-session-target"><option value="main">main</option><option value="isolated">isolated</option></select>
    <select id="cron-schedule-kind"><option value="cron">cron</option><option value="at">at</option></select>
    <input id="cron-expr" />
    <input id="cron-tz" />
    <input id="cron-at" />
    <select id="cron-model"></select>
    <input id="cron-timeout" />
    <textarea id="cron-prompt"></textarea>
    <div id="cron-model-group"></div>
    <div id="cron-timeout-group"></div>
    <span id="cron-prompt-label"></span>
    <div id="cron-expr-group"></div>
    <div id="cron-tz-group"></div>
    <div id="cron-at-group"></div>
    <button id="cron-modal-close"></button>
  </div>
`;
window.HUD = window.HUD || {};
window._agents = [{ id: "bot1" }, { id: "bot2" }];
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
window._modelAliases = [{ alias: "gpt4", fullId: "openai/gpt-4" }];
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

await import("../../../public/utils.js");
await import("../../../public/panels/cron.js");

describe("cron.render", () => {
  beforeEach(() => {
    document.getElementById("cron-count").textContent = "";
    document.getElementById("cron-list").innerHTML = "";
  });

  it("renders cron job count", () => {
    HUD.cron.render({
      jobs: [
        {
          id: "j1",
          name: "Test Job",
          enabled: true,
          schedule: { expr: "*/5 * * * *", tz: "UTC" },
          state: {},
        },
      ],
    });
    expect(document.getElementById("cron-count").textContent).toBe("1");
  });

  it("renders job rows with correct structure", () => {
    HUD.cron.render({
      jobs: [
        {
          id: "j1",
          name: "My Job",
          enabled: true,
          agentId: "bot1",
          schedule: { expr: "0 * * * *", tz: "America/Chicago" },
          state: {
            lastStatus: "completed",
            lastRunAtMs: Date.now() - 60000,
            nextRunAtMs: Date.now() + 60000,
          },
        },
      ],
    });
    const rows = document.querySelectorAll(".cron-row-v2");
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector(".cron-name").textContent).toContain("My Job");
    expect(rows[0].querySelector(".cron-schedule").textContent).toContain("0 * * * *");
  });

  it("shows error styling for failed jobs", () => {
    HUD.cron.render({
      jobs: [
        {
          id: "j1",
          name: "Failed",
          enabled: true,
          schedule: { expr: "* * * * *" },
          state: { lastStatus: "error", consecutiveErrors: 3, lastError: "timeout" },
        },
      ],
    });
    const html = document.getElementById("cron-list").innerHTML;
    expect(html).toContain("errors: 3");
    expect(html).toContain("timeout");
  });

  it("renders empty jobs", () => {
    HUD.cron.render({ jobs: [] });
    expect(document.getElementById("cron-count").textContent).toBe("0");
  });

  it("does not allow attribute injection through status text in aria-label", () => {
    HUD.cron.render({
      jobs: [
        {
          id: "j1",
          name: "Inject Test",
          enabled: true,
          agentId: "bot1",
          schedule: { expr: "* * * * *", tz: "UTC" },
          state: { lastStatus: 'ok" data-pwned="1" x="' },
        },
      ],
    });

    const row = document.querySelector(".cron-row-v2");
    expect(row).not.toBeNull();
    expect(row.hasAttribute("data-pwned")).toBe(false);
  });
});

describe("cron.openEditor", () => {
  it("populates modal fields from job data", () => {
    HUD.cron.render({
      jobs: [
        {
          id: "j1",
          name: "Edit Me",
          enabled: true,
          agentId: "bot1",
          schedule: { expr: "*/10 * * * *", tz: "UTC" },
          payload: { model: "openai/gpt-4" },
          state: {},
        },
      ],
    });
    HUD.cron.openEditor("j1");
    expect(document.getElementById("cron-edit-name").textContent).toBe("Edit Me");
    expect(document.getElementById("cron-name").value).toBe("Edit Me");
    expect(document.getElementById("cron-enabled").checked).toBe(true);
    expect(document.getElementById("cron-modal").classList.contains("active")).toBe(true);
  });

  it("does nothing for nonexistent job", () => {
    document.getElementById("cron-modal").classList.remove("active");
    HUD.cron.render({ jobs: [] });
    HUD.cron.openEditor("nonexistent");
    expect(document.getElementById("cron-modal").classList.contains("active")).toBe(false);
  });
});

describe("cron.closeModal", () => {
  it("removes active class from modal", () => {
    document.getElementById("cron-modal").classList.add("active");
    HUD.cron.closeModal();
    expect(document.getElementById("cron-modal").classList.contains("active")).toBe(false);
  });
});
