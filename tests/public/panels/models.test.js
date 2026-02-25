// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";

document.body.innerHTML = '<div id="model-usage"></div>';
window.HUD = window.HUD || {};
window.escapeHtml = function (s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
};

await import("../../../public/panels/models.js");

describe("formatTokens", () => {
  it("returns plain number for < 1000", () => {
    expect(HUD.models.formatTokens(500)).toBe("500");
  });
  it("returns K for thousands", () => {
    expect(HUD.models.formatTokens(1500)).toBe("1.5K");
  });
  it("returns M for millions", () => {
    expect(HUD.models.formatTokens(1500000)).toBe("1.5M");
  });
  it("handles exact 1000", () => {
    expect(HUD.models.formatTokens(1000)).toBe("1.0K");
  });
  it("handles exact 1000000", () => {
    expect(HUD.models.formatTokens(1000000)).toBe("1.0M");
  });
  it("handles 0", () => {
    expect(HUD.models.formatTokens(0)).toBe("0");
  });
});

describe("render", () => {
  beforeEach(() => {
    document.getElementById("model-usage").innerHTML = "";
  });

  it("renders model bars from live-weekly contract and period label", () => {
    HUD.models.render({
      meta: { tz: "America/Chicago" },
      models: [
        {
          provider: "openai",
          model: "gpt-4",
          totalTokens: 5000,
          inputTokens: 3000,
          outputTokens: 1500,
          cacheReadTokens: 500,
          totalCost: 0.15,
          agents: { myAgent: { totalTokens: 5000 } },
        },
      ],
      totals: { totalTokens: 5000 },
    });

    const el = document.getElementById("model-usage");
    expect(el.querySelectorAll(".model-bar-row").length).toBe(1);
    expect(el.querySelector(".models-period-label").textContent).toContain(
      "This week (Sun → now, America/Chicago)",
    );
    expect(el.querySelector(".model-bar-label").textContent).toContain("gpt-4");
    expect(el.querySelector(".token-cost").textContent).toBe("$0.15");
  });

  it("renders empty state for missing/empty models array", () => {
    HUD.models.render({ meta: { tz: "America/Chicago" }, models: [], totals: {} });
    expect(document.getElementById("model-usage").textContent).toContain("No model data yet");

    HUD.models.render(null);
    expect(document.getElementById("model-usage").textContent).toContain("No model data yet");
  });

  it("sorts by totalTokens descending", () => {
    HUD.models.render({
      meta: { tz: "UTC" },
      models: [
        {
          provider: "a",
          model: "small",
          totalTokens: 100,
          inputTokens: 50,
          outputTokens: 50,
          cacheReadTokens: 0,
          totalCost: 0,
        },
        {
          provider: "b",
          model: "big",
          totalTokens: 9000,
          inputTokens: 5000,
          outputTokens: 4000,
          cacheReadTokens: 0,
          totalCost: 0,
        },
      ],
      totals: { totalTokens: 9100 },
    });
    const labels = document.querySelectorAll(".model-bar-label");
    expect(labels[0].textContent).toContain("big");
  });

  it("hides cost when zero", () => {
    HUD.models.render({
      meta: { tz: "UTC" },
      models: [
        {
          provider: "x",
          model: "model",
          totalTokens: 100,
          inputTokens: 50,
          outputTokens: 50,
          cacheReadTokens: 0,
          totalCost: 0,
        },
      ],
      totals: { totalTokens: 100 },
    });
    expect(document.querySelector(".token-cost")).toBeNull();
  });
});
