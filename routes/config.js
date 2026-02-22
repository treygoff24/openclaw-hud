const path = require('path');
const { Router } = require('express');
const { OPENCLAW_HOME, safeJSON5, stripSecrets } = require('../lib/helpers');

const router = Router();

router.get('/api/config', (req, res) => {
  const config = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  if (!config) return res.json({});
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
  res.json(aliases);
});

router.get('/api/model-usage', (req, res) => {
  const fs = require('fs');
  const { OPENCLAW_HOME, safeReaddir, safeRead } = require('../lib/helpers');
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  const agents = safeReaddir(agentsDir);
  const usage = {};

  const ensure = (model) => {
    if (!usage[model]) usage[model] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, totalCost: 0, agents: {} };
  };
  const ensureAgent = (model, agentId) => {
    if (!usage[model].agents[agentId]) usage[model].agents[agentId] = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  };

  for (const agentId of agents) {
    const sessDir = path.join(agentsDir, agentId, 'sessions');
    const files = safeReaddir(sessDir).filter(f => f.endsWith('.jsonl'))
      .map(f => { try { return { name: f, mtime: fs.statSync(path.join(sessDir, f)).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 10)
      .map(f => f.name);
    for (const file of files) {
      const raw = safeRead(path.join(sessDir, file));
      if (!raw) continue;
      let currentModel = null;
      for (const line of raw.split('\n').filter(Boolean)) {
        try {
          const e = JSON.parse(line);
          if (e.type === 'model_change' && e.modelId) {
            currentModel = e.modelId;
          }
          if (e.type === 'message' && e.message?.usage) {
            const u = e.message.usage;
            const model = e.message.model || currentModel || 'unknown';
            ensure(model);
            ensureAgent(model, agentId);
            const inp = u.input || 0;
            const out = u.output || 0;
            const cr = u.cacheRead || 0;
            const cw = u.cacheWrite || 0;
            const tot = u.totalTokens || (inp + out + cr + cw);
            const cost = u.cost?.total || 0;
            usage[model].inputTokens += inp;
            usage[model].outputTokens += out;
            usage[model].cacheReadTokens += cr;
            usage[model].cacheWriteTokens += cw;
            usage[model].totalTokens += tot;
            usage[model].totalCost += cost;
            usage[model].agents[agentId].inputTokens += inp;
            usage[model].agents[agentId].outputTokens += out;
            usage[model].agents[agentId].totalTokens += tot;
          }
        } catch {}
      }
    }
  }
  res.json(usage);
});

module.exports = router;
