// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

window.HUDApp = window.HUDApp || {};
await import("../../public/app/status.js");

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function createMockDocument() {
  const elements = {
    "stat-uptime": { textContent: "" },
    clock: { textContent: "" },
  };

  const header = { appendChild: vi.fn() };

  return {
    elements,
    header,
    body: { firstElementChild: header },
    getElementById: vi.fn((id) => elements[id] || null),
    querySelector: vi.fn((selector) => {
      if (selector === "header") return header;
      if (selector === ".header") return null;
      if (selector === "#clock") return elements.clock;
      return null;
    }),
    createElement: vi.fn((tagName) => {
      const created = {
        id: null,
        textContent: "",
        style: {},
        tagName,
      };
      Object.defineProperty(created, "id", {
        configurable: true,
        get() {
          return this._id;
        },
        set(nextId) {
          this._id = nextId;
          if (nextId) elements[nextId] = this;
        },
      });
      return created;
    }),
  };
}

describe("HUDApp.status.createStatusController", () => {
  it("renders and updates connection badge state", () => {
    const document = createMockDocument();
    const controller = window.HUDApp.status.createStatusController({
      document,
      querySelector: document.querySelector,
    });

    controller.setConnectionStatus(false);

    expect(document.createElement).toHaveBeenCalledWith("span");
    const createdBadge = document.elements["connection-badge"];
    expect(createdBadge).toBeDefined();
    expect(createdBadge.id).toBe("connection-badge");
    expect(createdBadge.textContent).toBe("⚠ DISCONNECTED");
    expect(createdBadge.style.display).toBe("inline");

    controller.setConnectionStatus(true);
    expect(createdBadge.textContent).toBe("");
    expect(createdBadge.style.display).toBe("none");
    expect(controller.isConnected()).toBe(true);
  });

  it("ignores invalid gateway uptime and formats valid uptime snapshots", () => {
    const document = createMockDocument();
    const nowAnchor = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(nowAnchor);

    const controller = window.HUDApp.status.createStatusController({
      document,
      querySelector: document.querySelector,
    });

    controller.setGatewayUptimeSnapshot("abc");
    expect(document.getElementById("stat-uptime").textContent).toBe("");

    controller.setGatewayUptimeSnapshot(12_300);
    expect(document.getElementById("stat-uptime").textContent).toBe("00:00:12");

    nowSpy.mockRestore();
  });

  it("updates clock text immediately when started", () => {
    vi.useFakeTimers();
    const document = createMockDocument();
    const controller = window.HUDApp.status.createStatusController({
      document,
      querySelector: document.querySelector,
    });

    controller.start();

    expect(document.getElementById("clock").textContent.length).toBeGreaterThan(0);
  });
});
