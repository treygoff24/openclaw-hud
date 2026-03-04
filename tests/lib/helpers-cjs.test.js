const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const TMPDIR = path.join(os.tmpdir(), "helpers-cjs-test-" + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

// Use require() to load the CJS module — this ensures V8 instruments the CJS path
const helpers = require("../../lib/helpers.js");

describe("helpers via CJS require()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    helpers.invalidateModelAliasMapCache();
  });

  it("safeRead returns content for existing file", () => {
    const fp = path.join(TMPDIR, "test.txt");
    fs.writeFileSync(fp, "data");
    expect(helpers.safeRead(fp)).toBe("data");
  });

  it("safeRead returns null for missing file", () => {
    expect(helpers.safeRead(path.join(TMPDIR, "nope"))).toBeNull();
  });

  it("safeJSON parses valid JSON", () => {
    const fp = path.join(TMPDIR, "data.json");
    fs.writeFileSync(fp, '{"x":1}');
    expect(helpers.safeJSON(fp)).toEqual({ x: 1 });
  });

  it("safeJSON returns null for invalid", () => {
    expect(helpers.safeJSON(path.join(TMPDIR, "nope"))).toBeNull();
  });

  it("safeJSON5 parses JSON5", () => {
    const fp = path.join(TMPDIR, "c.json5");
    fs.writeFileSync(fp, '{ key: "val", }');
    expect(helpers.safeJSON5(fp)).toEqual({ key: "val" });
  });

  it("safeReaddir returns entries", () => {
    const dp = path.join(TMPDIR, "dir");
    fs.mkdirSync(dp, { recursive: true });
    fs.writeFileSync(path.join(dp, "a"), "");
    expect(helpers.safeReaddir(dp)).toContain("a");
  });

  it("stripSecrets removes keys", () => {
    expect(helpers.stripSecrets({ apiKey: "x", name: "ok" })).toEqual({ name: "ok" });
  });

  it("getSessionStatus returns active for recent", () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() })).toBe("active");
  });

  it("getSessionStatus returns warm", () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() - 6 * 60 * 1000 })).toBe("warm");
  });

  it("getSessionStatus returns stale", () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() - 2 * 60 * 60 * 1000 })).toBe("stale");
  });

  it("getSessionStatus returns completed for subagent", () => {
    expect(helpers.getSessionStatus({ updatedAt: Date.now() - 6 * 60 * 1000, spawnDepth: 1 })).toBe(
      "completed",
    );
  });

  it("getGatewayConfig returns host/bind/port/token shape", () => {
    const cfg = helpers.getGatewayConfig();
    expect(cfg).toHaveProperty("host");
    expect(cfg).toHaveProperty("bind");
    expect(typeof cfg.port).toBe("number");
    expect(cfg).toHaveProperty("token");
  });

  it("OPENCLAW_HOME is defined", () => {
    expect(typeof helpers.OPENCLAW_HOME).toBe("string");
  });

  it("enrichSessionMetadata uses provided aliases without reading config", () => {
    const originalGetModelAliasMap = helpers.getModelAliasMap;
    const getModelAliasMapMock = vi.fn(() => ({}));
    helpers.getModelAliasMap = getModelAliasMapMock;

    const metadata = helpers.enrichSessionMetadata(
      "main",
      { model: "openai/gpt-4o" },
      {
        sessionKey: "agent:test:main",
        modelAliases: {
          "openai/gpt-4o": { alias: "gpt4o" },
        },
      },
    );

    expect(metadata.modelLabel).toBe("gpt4o");
    expect(getModelAliasMapMock).not.toHaveBeenCalled();
    helpers.getModelAliasMap = originalGetModelAliasMap;
  });

  it("prewarms model alias cache and recomputes aliases after config path change", () => {
    const watchCallbacks = new Map();
    const originalEnvValue = process.env.HUD_MODELS_CACHE_TTL_MS;
    process.env.HUD_MODELS_CACHE_TTL_MS = "0";

    const watchSpy = vi.spyOn(fs, "watch").mockImplementation((filePath, _options, onChange) => {
      watchCallbacks.set(String(filePath), onChange);
      return { close: vi.fn() };
    });

    const openclawConfigPath = path.join(helpers.OPENCLAW_HOME, "openclaw.json");
    const readFileSpy = vi.spyOn(fs, "readFileSync");
    let openclawReadCount = 0;
    readFileSpy.mockImplementation((targetPath) => {
      if (String(targetPath) === openclawConfigPath) {
        openclawReadCount += 1;
        if (openclawReadCount === 1) {
          return JSON.stringify({
            agents: {
              defaults: {
                models: {
                  "openai/gpt-4o": { alias: "alias-v1" },
                },
              },
            },
          });
        }
        return JSON.stringify({
          agents: {
            defaults: {
              models: {
                "openai/gpt-4o-mini": { alias: "alias-v2" },
              },
            },
          },
        });
      }
      return "";
    });

    const onRecompute = vi.fn();

    try {
      vi.useFakeTimers();

      const map = helpers.prewarmModelAliasMapCache(onRecompute);
      expect(map).toEqual({ "openai/gpt-4o": { alias: "alias-v1" } });
      expect(readFileSpy).toHaveBeenCalledTimes(2);
      expect(watchSpy).toHaveBeenCalledTimes(2);
      expect(onRecompute).not.toHaveBeenCalled();

      const onChange = watchCallbacks.values().next().value;
      expect(typeof onChange).toBe("function");
      onChange();
      vi.advanceTimersByTime(50);
      expect(onRecompute).toHaveBeenCalledTimes(1);
      expect(onRecompute).toHaveBeenCalledWith({
        "openai/gpt-4o-mini": { alias: "alias-v2" },
      });
    } finally {
      vi.useRealTimers();
      watchSpy.mockRestore();
      readFileSpy.mockRestore();
      if (originalEnvValue === undefined) {
        delete process.env.HUD_MODELS_CACHE_TTL_MS;
      } else {
        process.env.HUD_MODELS_CACHE_TTL_MS = originalEnvValue;
      }
      helpers.invalidateModelAliasMapCache();
    }
  });

  it("retries model alias watcher registration when config files are unavailable on first attempt", () => {
    helpers.invalidateModelAliasMapCache();
    const openclawConfigPath = path.join(helpers.OPENCLAW_HOME, "openclaw.json");
    const watchCallbacks = new Map();
    const watchSpy = vi.spyOn(fs, "watch");
    let attempt = 0;
    watchSpy.mockImplementation((filePath, _options, onChange) => {
      attempt += 1;
      if (attempt <= 2) {
        throw new Error("unavailable");
      }
      watchCallbacks.set(String(filePath), onChange);
      return { close: vi.fn() };
    });
    const readFileSpy = vi.spyOn(fs, "readFileSync").mockImplementation((targetPath) => {
      if (String(targetPath) === openclawConfigPath) {
        return JSON.stringify({
          agents: {
            defaults: {
              models: {
                "openai/gpt-5": { alias: "alias-v1" },
              },
            },
          },
        });
      }
      return "";
    });

    try {
      helpers.prewarmModelAliasMapCache();
      helpers.prewarmModelAliasMapCache();

      expect(watchSpy).toHaveBeenCalledTimes(4);
      expect(watchCallbacks.size).toBeGreaterThan(0);
    } finally {
      watchSpy.mockRestore();
      readFileSpy.mockRestore();
      helpers.invalidateModelAliasMapCache();
    }
  });

  it("invalidates model alias cache so subsequent reads rehydrate from disk", () => {
    const openclawConfigPath = path.join(helpers.OPENCLAW_HOME, "openclaw.json");
    const readFileSpy = vi.spyOn(fs, "readFileSync");
    let openclawReadCount = 0;
    readFileSpy.mockImplementation((targetPath) => {
      if (String(targetPath) === openclawConfigPath) {
        openclawReadCount += 1;
        if (openclawReadCount === 1) {
          return JSON.stringify({
            agents: {
              defaults: {
                models: {
                  "openai/gpt-4": { alias: "first" },
                },
              },
            },
          });
        }
        return JSON.stringify({
          agents: {
            defaults: {
              models: {
                "openai/gpt-5": { alias: "second" },
              },
            },
          },
        });
      }
      return "";
    });

    const first = helpers.getModelAliasMap();
    helpers.invalidateModelAliasMapCache();
    const second = helpers.getModelAliasMap();

    expect(first).toEqual({ "openai/gpt-4": { alias: "first" } });
    expect(second).toEqual({ "openai/gpt-5": { alias: "second" } });
    expect(readFileSpy).toHaveBeenCalledTimes(4);
  });
});
