const path = require('path');
const { Router } = require('express');
const { OPENCLAW_HOME, safeJSON5, stripSecrets, getGatewayConfig } = require('../lib/helpers');
const spawnRouter = require('./spawn');

const router = Router();

router.get('/api/config', (req, res) => {
  // Use getGatewayConfig() for primary config with fallback to legacy source-of-truth.json5
  const primaryConfig = safeJSON5(path.join(OPENCLAW_HOME, 'openclaw.json'));
  const legacyConfig = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const config = primaryConfig || legacyConfig || {};
  
  if (!config || Object.keys(config).length === 0) return res.json({});
  
  const defaults = config.agents?.defaults || {};
  const gateway = config.gateway || {};
  const channels = config.channels || {};
  const models = config.models || {};
  res.json(stripSecrets({
    defaultModel: defaults.model?.primary || 'unknown',
    maxConcurrent: defaults.maxConcurrent,
    subagents: defaults.subagents,
    gateway: { port: gateway.port, mode: gateway.mode, bind: gateway.bind },
    channels: Object.keys(channels),
    models: defaults.models || {},
    modelAliases: defaults.models || {},
    providers: Object.keys(models.providers || {}),
    meta: config.meta
  }));
});

router.get('/api/models', (req, res) => {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const models = config?.agents?.defaults?.models || {};
  const aliases = Object.entries(models).map(([fullId, cfg]) => ({
    alias: cfg.alias || fullId.split('/').pop(),
    fullId,
  }));
  const agentModels = [
    { alias: 'haiku', fullId: 'anthropic/claude-haiku-4' },
    { alias: 'vulcan (codex)', fullId: 'openai/gpt-5.3-codex' },
  ];
  for (const am of agentModels) {
    if (!aliases.find(a => a.fullId === am.fullId)) aliases.push(am);
  }
  aliases.unshift({ alias: 'default', fullId: '' });
  
  // Update cached models for spawn route label resolution
  if (spawnRouter.setCachedModels) {
    spawnRouter.setCachedModels(aliases);
  }
  
  res.json(aliases);
});

module.exports = router;
