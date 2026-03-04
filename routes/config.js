const path = require("path");
const { Router } = require("express");
const { performance } = require("perf_hooks");
const helpers = require("../lib/helpers");
const spawnRouter = require("./spawn");
const { createInProcessMemoCache } = require("../lib/inprocess-memo-cache");

const router = Router();
const modelsCache = createInProcessMemoCache({ name: "api-models" });

const HUD_MODELS_CACHE_TTL_MS = "HUD_MODELS_CACHE_TTL_MS";

function getCacheTtlMsFromEnv() {
  const rawValue = Number(process.env[HUD_MODELS_CACHE_TTL_MS]);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0;
  return rawValue;
}

function getModelConfigPaths() {
  return [
    path.join(helpers.OPENCLAW_HOME, "openclaw.json"),
    path.join(helpers.OPENCLAW_HOME, "config", "source-of-truth.json5"),
  ];
}

function toTimingValue(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function writeModelEndpointHeaders(res, timing, cacheState) {
  res.set(
    "x-hud-endpoint-timing-ms",
    JSON.stringify({
      diskReadMs: toTimingValue(timing.diskReadMs),
      parseMs: toTimingValue(timing.parseMs),
      computeMs: toTimingValue(timing.computeMs),
      serializeMs: toTimingValue(timing.serializeMs),
    }),
  );
  res.set("x-hud-cache-state", JSON.stringify(cacheState || { state: "disabled" }));
}

function buildModelsPayload(config) {
  const models = config?.agents?.defaults?.models || {};
  const aliases = Object.entries(models).map(([fullId, cfg]) => ({
    alias: resolveModelAlias(fullId, cfg),
    fullId,
  }));
  aliases.unshift({ alias: "default", fullId: "" });
  return aliases;
}

function loadConfig() {
  const primaryConfig = helpers.safeJSON5(path.join(helpers.OPENCLAW_HOME, "openclaw.json"));
  const legacyConfig = helpers.safeJSON5(
    path.join(helpers.OPENCLAW_HOME, "config", "source-of-truth.json5"),
  );
  return primaryConfig || legacyConfig || {};
}

function resolveModelAlias(fullId, modelConfig) {
  const alias =
    modelConfig &&
    typeof modelConfig === "object" &&
    typeof modelConfig.alias === "string" &&
    modelConfig.alias.trim();

  if (alias) return alias;

  if (typeof fullId !== "string") return "";
  return fullId.split("/").pop() || fullId;
}

router.get("/api/config", (req, res) => {
  const config = loadConfig();

  if (!config || Object.keys(config).length === 0) return res.json({});

  const defaults = config.agents?.defaults || {};
  const gateway = config.gateway || {};
  const channels = config.channels || {};
  const models = config.models || {};
  res.json(
    helpers.stripSecrets({
      defaultModel: defaults.model?.primary || "unknown",
      maxConcurrent: defaults.maxConcurrent,
      subagents: defaults.subagents,
      gateway: { port: gateway.port, mode: gateway.mode, bind: gateway.bind },
      channels: Object.keys(channels),
      models: defaults.models || {},
      modelAliases: defaults.models || {},
      providers: Object.keys(models.providers || {}),
      meta: config.meta,
    }),
  );
});

router.get("/api/models", async (req, res) => {
  const ttlMs = getCacheTtlMsFromEnv();

  const result = await modelsCache.getOrSet({
    key: "models",
    ttlMs,
    getDependencyPaths: getModelConfigPaths,
    loader: () => {
      const diskStartMs = performance.now();
      const config = loadConfig();
      const diskReadMs = performance.now() - diskStartMs;

      const parseStartMs = performance.now();
      const aliases = buildModelsPayload(config);
      const parseMs = performance.now() - parseStartMs;

      return {
        value: aliases,
        cacheMeta: {
          diskReadMs,
          parseMs,
        },
        dependencyPaths: getModelConfigPaths(),
      };
    },
  });

  const aliases = result.value;
  const timing = {
    diskReadMs: result.fromCache ? 0 : toTimingValue(result.cacheMeta?.diskReadMs),
    parseMs: result.fromCache ? 0 : toTimingValue(result.cacheMeta?.parseMs),
    computeMs: result.fromCache ? 0 : toTimingValue(result.cacheMeta?.computeMs),
    serializeMs: 0,
  };

  // Update cached models for spawn route label resolution
  const computeStartMs = performance.now();
  if (spawnRouter.setCachedModels) {
    spawnRouter.setCachedModels(aliases);
  }
  timing.computeMs += performance.now() - computeStartMs;

  const serializeStartMs = performance.now();
  const body = JSON.stringify(aliases);
  timing.serializeMs = performance.now() - serializeStartMs;

  writeModelEndpointHeaders(res, timing, result.cacheState);
  res.type("json").send(body);
});

module.exports = router;
