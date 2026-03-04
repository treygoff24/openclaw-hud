const path = require("path");
const { Router } = require("express");
const helpers = require("../lib/helpers");
const spawnRouter = require("./spawn");

const router = Router();

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

router.get("/api/models", (req, res) => {
  const config = loadConfig();

  const models = config?.agents?.defaults?.models || {};
  const aliases = Object.entries(models).map(([fullId, cfg]) => ({
    alias: resolveModelAlias(fullId, cfg),
    fullId,
  }));
  aliases.unshift({ alias: "default", fullId: "" });

  // Update cached models for spawn route label resolution
  if (spawnRouter.setCachedModels) {
    spawnRouter.setCachedModels(aliases);
  }

  res.json(aliases);
});

module.exports = router;
