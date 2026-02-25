#!/usr/bin/env node

// Archives the just-ended previous week (Sunday 00:00 -> Sunday 00:00 in HUD_USAGE_TZ)
// and treats EEXIST writes as idempotent success for safe cron reruns.

const { getLiveWeekWindow } = require('../lib/helpers');
const { toFiniteNumber } = require('../lib/number');
const { requestSessionsUsage } = require('../lib/usage-rpc');
const { loadPricingCatalog, repriceModelUsageRows } = require('../lib/pricing');
const { writeWeeklySnapshot } = require('../lib/usage-archive');

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeModelRow(row) {
  const sourceRow = isObject(row) ? row : {};
  const totals = isObject(sourceRow.totals) ? sourceRow.totals : {};

  const provider =
    typeof sourceRow.provider === 'string' && sourceRow.provider.trim()
      ? sourceRow.provider
      : typeof sourceRow.model === 'string' && sourceRow.model.includes('/')
        ? sourceRow.model.split('/')[0]
        : 'unknown';
  const model =
    typeof sourceRow.model === 'string' && sourceRow.model.trim()
      ? sourceRow.model
      : 'unknown';

  const inputTokens = toFiniteNumber(totals.inputTokens ?? totals.input ?? sourceRow.inputTokens ?? sourceRow.input);
  const outputTokens = toFiniteNumber(totals.outputTokens ?? totals.output ?? sourceRow.outputTokens ?? sourceRow.output);
  const cacheReadTokens = toFiniteNumber(
    totals.cacheReadTokens ?? totals.cacheRead ?? sourceRow.cacheReadTokens ?? sourceRow.cacheRead,
  );
  const cacheWriteTokens = toFiniteNumber(
    totals.cacheWriteTokens ?? totals.cacheWrite ?? sourceRow.cacheWriteTokens ?? sourceRow.cacheWrite,
  );
  const totalTokens = toFiniteNumber(
    totals.totalTokens ??
      sourceRow.totalTokens ??
      sourceRow.total ??
      inputTokens +
      outputTokens +
      cacheReadTokens +
      cacheWriteTokens,
  );
  const totalCost = toFiniteNumber(
    totals.totalCost ??
      totals.cost?.total ??
      totals.cost ??
      sourceRow.totalCost ??
      sourceRow.cost?.total,
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
  const result = isObject(payload?.result) ? payload.result : {};
  if (Array.isArray(result.rows)) return result.rows;
  if (Array.isArray(result.aggregates?.byModel)) return result.aggregates.byModel;
  return [];
}

function getArchiveWeekWindow(tz = 'America/Chicago', nowMs = Date.now()) {
  const currentWeekWindow = getLiveWeekWindow(tz, nowMs);
  const previousWeekWindow = getLiveWeekWindow(tz, currentWeekWindow.fromMs - 1);

  return {
    fromMs: previousWeekWindow.fromMs,
    toMs: currentWeekWindow.fromMs,
  };
}

function buildWeeklySnapshot(payload, { tz, weekStartMs, weekEndMs, generatedAtMs }, deps = {}) {
  const usageRows = collectUsageRows(payload);

  const normalizedRows = [];
  for (const row of usageRows) {
    const modelRow = normalizeModelRow(row);
    if (modelRow.totalTokens <= 0) continue;
    normalizedRows.push(modelRow);
  }

  const loadCatalog = deps.loadPricingCatalog || loadPricingCatalog;
  const repriceRows = deps.repriceModelUsageRows || repriceModelUsageRows;

  const pricingCatalog = loadCatalog();
  const { rows: repricedRows, missingPricingModels } = repriceRows(normalizedRows, {
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

  return {
    meta: {
      period: 'weekly',
      tz,
      weekStart: new Date(weekStartMs).toISOString(),
      now: new Date(weekEndMs).toISOString(),
      generatedAt: new Date(generatedAtMs).toISOString(),
      source: 'sessions.usage+config-reprice',
      missingPricingModels,
    },
    models,
    totals,
  };
}

async function archiveWeeklyUsage(options = {}, deps = {}) {
  const tz = options.tz || process.env.HUD_USAGE_TZ || 'America/Chicago';
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  const requestUsage = deps.requestSessionsUsage || requestSessionsUsage;
  const archiveWrite = deps.writeWeeklySnapshot || writeWeeklySnapshot;
  const loadCatalog = deps.loadPricingCatalog || loadPricingCatalog;
  const repriceRows = deps.repriceModelUsageRows || repriceModelUsageRows;

  const { fromMs, toMs } = getArchiveWeekWindow(tz, nowMs);

  const payload = await requestUsage({
    from: fromMs,
    to: toMs,
    timezone: tz,
  });

  const snapshot = buildWeeklySnapshot(
    payload,
    {
      tz,
      weekStartMs: fromMs,
      weekEndMs: toMs,
      generatedAtMs: nowMs,
    },
    {
      loadPricingCatalog: loadCatalog,
      repriceModelUsageRows: repriceRows,
    },
  );

  try {
    const writeResult = archiveWrite(snapshot, options.openclawHome ? { openclawHome: options.openclawHome } : {});
    return {
      ok: true,
      alreadyArchived: false,
      weekStart: snapshot.meta.weekStart,
      path: writeResult?.path || null,
    };
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return {
        ok: true,
        alreadyArchived: true,
        weekStart: snapshot.meta.weekStart,
        path: null,
      };
    }
    throw error;
  }
}

async function main() {
  try {
    const result = await archiveWeeklyUsage();
    if (result.alreadyArchived) {
      process.stdout.write(`Weekly snapshot already archived for ${result.weekStart}.\n`);
      return;
    }
    process.stdout.write(`Archived week ${result.weekStart}.\n`);
  } catch (error) {
    process.stderr.write(`Failed to archive weekly usage: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getArchiveWeekWindow,
  archiveWeeklyUsage,
  buildWeeklySnapshot,
};
