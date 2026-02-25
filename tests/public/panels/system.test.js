// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

document.body.innerHTML = `
  <div id="system-info"></div>
  <span id="sys-model"></span>
`;
window.HUD = window.HUD || {};
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

await import("../../../public/panels/system.js");

describe("system.render", () => {
  beforeEach(() => {
    document.getElementById("system-info").innerHTML = "";
    document.getElementById("sys-model").textContent = "";
  });

  it("renders config fields", () => {
    HUD.system.render({
      defaultModel: "anthropic/claude-sonnet-4",
      gateway: { port: 18789, mode: "auto", bind: "0.0.0.0" },
      maxConcurrent: 5,
      subagents: { maxSpawnDepth: 3, maxChildren: 10 },
      channels: ["discord", "telegram"],
      providers: ["openai", "anthropic"],
    });
    const root = document.getElementById("system-info");
    const html = root.innerHTML;
    expect(html).toContain("anthropic/claude-sonnet-4");
    expect(html).toContain("18789");

    const lists = root.querySelectorAll(".sys-tag-list");
    expect(lists.length).toBeGreaterThanOrEqual(2);
    const tags = root.querySelectorAll(".sys-tag");
    expect(tags.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("discord, telegram");
  });

  it("sets sys-model text", () => {
    HUD.system.render({ defaultModel: "gpt-4" });
    expect(document.getElementById("sys-model").textContent).toBe("MODEL: gpt-4");
  });

  it("handles missing fields with dashes", () => {
    HUD.system.render({});
    const html = document.getElementById("system-info").innerHTML;
    expect(html).toContain("—");
    expect(document.getElementById("sys-model").textContent).toBe("MODEL: ?");
  });

  it("renders model aliases", () => {
    HUD.system.render({
      modelAliases: {
        "openai/gpt-4": { alias: "gpt4" },
        "anthropic/claude": "claude-alias",
      },
    });
    const html = document.getElementById("system-info").innerHTML;
    expect(html).toContain("gpt4");
    expect(html).toContain("claude-alias");
    expect(html).toContain("MODEL ALIASES");
  });
});
