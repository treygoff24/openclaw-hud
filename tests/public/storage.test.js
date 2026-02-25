// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock localStorage with quota tracking
function createMockStorage() {
  let store = {};
  let quotaBytes = 5 * 1024 * 1024;
  let currentBytes = 0;

  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      const oldValue = store[key];
      const newSize = new Blob([value]).size;
      const oldSize = oldValue ? new Blob([oldValue]).size : 0;

      if (currentBytes - oldSize + newSize > quotaBytes) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }

      currentBytes = currentBytes - oldSize + newSize;
      store[key] = value;
    }),
    removeItem: vi.fn((key) => {
      if (store[key]) {
        currentBytes -= new Blob([store[key]]).size;
        delete store[key];
      }
    }),
    clear: vi.fn(() => {
      store = {};
      currentBytes = 0;
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((i) => Object.keys(store)[i] ?? null),
    _getStore: () => store,
    _setQuota: (bytes) => {
      quotaBytes = bytes;
    },
  };
}

const mockStorage = createMockStorage();
Object.defineProperty(window, "localStorage", {
  value: mockStorage,
  writable: true,
  configurable: true,
});
window.HUD = window.HUD || {};

await import("../../public/storage.js");

describe("HUD.Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic operations", () => {
    it("gets and sets values", () => {
      const result = HUD.Storage.set("test-key", { foo: "bar" });
      expect(result).toBe(true);
      expect(HUD.Storage.get("test-key")).toEqual({ foo: "bar" });
    });

    it("returns null for missing keys", () => {
      expect(HUD.Storage.get("nonexistent-key-xyz")).toBe(null);
    });

    it("returns default for missing keys", () => {
      expect(HUD.Storage.get("nonexistent-key-abc", "default")).toBe("default");
    });

    it("handles string values", () => {
      HUD.Storage.set("str", "hello world");
      expect(HUD.Storage.get("str")).toBe("hello world");
    });

    it("handles number values", () => {
      HUD.Storage.set("num", 42);
      expect(HUD.Storage.get("num")).toBe(42);
    });

    it("handles boolean values", () => {
      HUD.Storage.set("bool", true);
      expect(HUD.Storage.get("bool")).toBe(true);
    });

    it("handles array values", () => {
      HUD.Storage.set("arr", [1, 2, 3]);
      expect(HUD.Storage.get("arr")).toEqual([1, 2, 3]);
    });
  });

  describe("namespace prefix", () => {
    it("prefixes keys with hud-", () => {
      HUD.Storage.set("prefix-test-key", "value");
      expect(mockStorage.setItem).toHaveBeenCalledWith("hud-prefix-test-key", expect.any(String));
    });
  });

  describe("getStorageInfo", () => {
    it("returns storage statistics", () => {
      HUD.Storage.set("stat-a", "1");
      const info = HUD.Storage.getStorageInfo();
      expect(info).toHaveProperty("used");
      expect(info).toHaveProperty("available");
      expect(typeof info.used).toBe("number");
    });
  });

  describe("isAvailable", () => {
    it("returns true when localStorage works", () => {
      expect(HUD.Storage.isAvailable()).toBe(true);
    });
  });

  describe("error handling", () => {
    it("returns null on invalid JSON", () => {
      mockStorage._getStore()["hud-bad-json"] = "not valid json {{{";
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = HUD.Storage.get("bad-json");
      expect(result).toBe(null);
      warnSpy.mockRestore();
    });
  });
});
