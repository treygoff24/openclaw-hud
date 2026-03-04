import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";

const { createInProcessMemoCache } = require("../../lib/inprocess-memo-cache");

function createStat(size, mtimeMs) {
  return {
    size,
    mtimeMs,
    isFile() {
      return true;
    },
  };
}

describe("createInProcessMemoCache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hashes dependency rows and invalidates cache when dependency metadata changes", async () => {
    const dependencyState = {
      "/tmp/a.json": { size: 10, mtimeMs: 1000 },
      "/tmp/b.json": { size: 20, mtimeMs: 2000 },
    };

    vi.spyOn(fs, "statSync").mockImplementation((filePath) => {
      const entry = dependencyState[String(filePath)];
      if (!entry) {
        throw new Error("missing");
      }
      return createStat(entry.size, entry.mtimeMs);
    });

    const cache = createInProcessMemoCache({ name: "test-cache" });
    const loader = vi.fn(async () => ({
      value: { ok: true },
      dependencyPaths: Object.keys(dependencyState),
    }));

    const first = await cache.getOrSet({
      key: "key",
      ttlMs: 5000,
      nowMs: 1000,
      loader,
    });
    const second = await cache.getOrSet({
      key: "key",
      ttlMs: 5000,
      nowMs: 1100,
      loader,
    });

    expect(first.cacheState.state).toBe("miss");
    expect(second.cacheState.state).toBe("hit");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(first.cacheState.dependencyHash).toMatch(/^[a-f0-9]{16}$/);
    expect(first.cacheState.dependencyHash).not.toBe("0|1");
    expect(second.cacheState.dependencyHash).toBe(first.cacheState.dependencyHash);

    dependencyState["/tmp/a.json"].mtimeMs = 3000;

    const third = await cache.getOrSet({
      key: "key",
      ttlMs: 5000,
      nowMs: 1200,
      loader,
    });

    expect(third.cacheState.state).toBe("stale");
    expect(third.cacheState.dependencyHash).toMatch(/^[a-f0-9]{16}$/);
    expect(third.cacheState.dependencyHash).not.toBe(first.cacheState.dependencyHash);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("uses idle dependency hash when dependency list is empty", async () => {
    const cache = createInProcessMemoCache({ name: "test-cache" });
    const loader = vi.fn(async () => ({
      value: { ok: true },
      dependencyPaths: [],
    }));

    const first = await cache.getOrSet({
      key: "no-deps",
      ttlMs: 1000,
      nowMs: 10,
      loader,
    });

    const second = await cache.getOrSet({
      key: "no-deps",
      ttlMs: 1000,
      nowMs: 20,
      loader,
    });

    expect(first.cacheState.dependencyHash).toBe("idle");
    expect(first.cacheState.dependencyCount).toBe(0);
    expect(second.cacheState.state).toBe("hit");
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
