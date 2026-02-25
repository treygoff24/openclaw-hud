const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const { OPENCLAW_HOME, safeReaddir, safeRead, getLiveWeekWindow } = require('../lib/helpers');
const { toFiniteNumber } = require('../lib/number');
const { requestSessionsUsage } = require('../lib/usage-rpc');
const { loadPricingCatalog, repriceModelUsageRows } = require('../lib/pricing');

const router = Router();

let liveWeeklyCache = null;

function getUsageCacheTtlMs() {
  const ttlMs = Number(process.env.HUD_USAGE_CACHE_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
  return ttlMs;
}

function shouldRefreshLiveWeekly(req) {
  const refresh = req?.query?.refresh;
  return refresh === '1' || refresh === 1 || refresh === true;
}

function normalizeModelRow(row) {
  const totals = row?.totals && typeof row.totals === 'object' ? row.totals : {};

  const provider =
    typeof row?.provider === 'string' && row.provider.trim()
      ? row.provider
      : typeof row?.model === 'string' && row.model.includes('/')
        ? row.model.split('/')[0]
        : 'unknown';
  const model =
    typeof row?.model === 'string' && row.model.trim()
      ? row.model
      : 'unknown';

  const inputTokens = toFiniteNumber(totals.inputTokens ?? totals.input ?? row?.inputTokens ?? row?.input);
  const outputTokens = toFiniteNumber(totals.outputTokens ?? totals.output ?? row?.outputTokens ?? row?.output);
  const cacheReadTokens = toFiniteNumber(
    totals.cacheReadTokens ?? totals.cacheRead ?? row?.cacheReadTokens ?? row?.cacheRead,
  );
  const cacheWriteTokens = toFiniteNumber(
    totals.cacheWriteTokens ?? totals.cacheWrite ?? row?.cacheWriteTokens ?? row?.cacheWrite,
  );
  const totalTokens = toFiniteNumber(
    totals.totalTokens ??
      row?.totalTokens ??
      row?.total ??
      inputTokens +
      outputTokens +
      cacheReadTokens +
      cacheWriteTokens,
  );
  const totalCost = toFiniteNumber(
    totals.totalCost ??
      totals.cost ??
      totals.cost?.total ??
      row?.totalCost ??
      row?.cost?.total,
  );

  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    totalCost,
  };
}

function collectUsageRows(payload) {
  const result = payload?.result;
  if (Array.isArray(result?.rows)) return result.rows;
  if (Array.isArray(result?.aggregates?.byModel)) return result.aggregates.byModel;
  return [];
}

router.get('/api/model-usage', (req, res) => {
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

router.get('/api/model-usage/live-weekly', async (req, res) => {
  const tz = process.env.HUD_USAGE_TZ || 'America/Chicago';
  const nowMs = Date.now();
  const ttlMs = getUsageCacheTtlMs();
  const refresh = shouldRefreshLiveWeekly(req);

  if (!refresh && liveWeeklyCache && nowMs < liveWeeklyCache.expiresAtMs) {
    return res.json(liveWeeklyCache.payload);
  }

  const liveWindow = getLiveWeekWindow(tz, nowMs);

  try {
    const payload = await requestSessionsUsage({
      from: liveWindow.fromMs,
      to: liveWindow.toMs,
      timezone: tz,
    });

    const usageRows = collectUsageRows(payload);

    const normalizedRows = [];
    for (const row of usageRows) {
      const modelRow = normalizeModelRow(row);
      if (modelRow.totalTokens <= 0) continue;
      normalizedRows.push(modelRow);
    }

    const pricingCatalog = loadPricingCatalog();
    const { rows: repricedRows, missingPricingModels } = repriceModelUsageRows(normalizedRows, {
      catalog: pricingCatalog,
    });

    const models = [];
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    };

    for (const modelRow of repricedRows) {
      models.push(modelRow);
      totals.inputTokens += modelRow.inputTokens;
      totals.outputTokens += modelRow.outputTokens;
      totals.cacheReadTokens += modelRow.cacheReadTokens;
      totals.cacheWriteTokens += modelRow.cacheWriteTokens;
      totals.totalTokens += modelRow.totalTokens;
      totals.totalCost += modelRow.totalCost;
    }

    const responsePayload = {
      meta: {
        period: 'live-weekly',
        tz,
        weekStart: new Date(liveWindow.fromMs).toISOString(),
        now: new Date(liveWindow.toMs).toISOString(),
        generatedAt: new Date(nowMs).toISOString(),
        source: 'sessions.usage+config-reprice',
        missingPricingModels,
      },
      models,
      totals,
    };

    if (ttlMs > 0) {
      liveWeeklyCache = {
        expiresAtMs: nowMs + ttlMs,
        payload: responsePayload,
      };
    } else {
      liveWeeklyCache = null;
    }

    res.json(responsePayload);
  } catch (err) {
    res.status(502).json({ error: `Failed to load live weekly usage: ${err.message}` });
  }
});

module.exports = router;