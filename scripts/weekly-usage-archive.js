#!/usr/bin/env node

// Archives weekly usage windows ending at the current week boundary in HUD_USAGE_TZ.
// Automatically backfills missed weekly windows and treats EEXIST writes as idempotent success.

const { getLiveWeekWindow } = require('../lib/helpers');
const { requestSessionsUsage } = require('../lib/usage-rpc');
const { loadPricingCatalog, repriceModelUsageRows } = require('../lib/pricing');
const { writeWeeklySnapshot, readWeeklyHistory } = require('../lib/usage-archive');
const { normalizeModelRow, collectUsageRows } = require('../lib/usage-normalize');

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getArchiveWeekWindows(options = {}, deps = {}) {
  const tz = options.tz || process.env.HUD_USAGE_TZ || 'America/Chicago';
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const currentWeekWindow = getLiveWeekWindow(tz, nowMs);
  const previousWeekStartMs = currentWeekWindow.fromMs - ONE_WEEK_MS;

  const readHistory = deps.readWeeklyHistory || readWeeklyHistory;
  const readHistoryOptions = options.openclawHome ? { openclawHome: options.openclawHome } : {};

  let latestArchivedWeekStartMs = null;
  for (const snapshot of readHistory(readHistoryOptions)) {
    const weekStartMs = Date.parse(snapshot?.meta?.weekStart || '');
    if (!Number.isFinite(weekStartMs)) continue;
    if (weekStartMs >= currentWeekWindow.fromMs) continue;
    if (latestArchivedWeekStartMs === null || weekStartMs > latestArchivedWeekStartMs) {
      latestArchivedWeekStartMs = weekStartMs;
    }
  }

  let firstWeekStartMs = previousWeekStartMs;
  if (latestArchivedWeekStartMs !== null) {
    const firstMissingWeekStartMs = latestArchivedWeekStartMs + ONE_WEEK_MS;
    if (firstMissingWeekStartMs <= previousWeekStartMs) {
      firstWeekStartMs = firstMissingWeekStartMs;
    }
  }

  const windows = [];
  for (let fromMs = firstWeekStartMs; fromMs <= previousWeekStartMs; fromMs += ONE_WEEK_MS) {
    windows.push({ fromMs, toMs: fromMs + ONE_WEEK_MS });
  }

  return windows;
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
  const readHistory = deps.readWeeklyHistory || readWeeklyHistory;

  const windows = getArchiveWeekWindows(options, { readWeeklyHistory: readHistory });
  const archiveWriteOptions = options.openclawHome ? { openclawHome: options.openclawHome } : {};

  let archivedCount = 0;
  let alreadyArchivedCount = 0;
  let lastWeekStart = null;
  let lastPath = null;

  for (const { fromMs, toMs } of windows) {
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

    lastWeekStart = snapshot.meta.weekStart;

    try {
      const writeResult = archiveWrite(snapshot, archiveWriteOptions);
      archivedCount += 1;
      lastPath = writeResult?.path || null;
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        alreadyArchivedCount += 1;
        continue;
      }
      throw error;
    }
  }

  return {
    ok: true,
    alreadyArchived: archivedCount === 0 && alreadyArchivedCount > 0,
    weekStart: lastWeekStart,
    path: lastPath,
    archivedCount,
    alreadyArchivedCount,
    processedWeeks: archivedCount + alreadyArchivedCount,
  };
}

async function main() {
  try {
    const result = await archiveWeeklyUsage();
    if (result.processedWeeks > 1) {
      process.stdout.write(
        `Archived ${result.archivedCount} weekly snapshots (${result.alreadyArchivedCount} already existed), latest ${result.weekStart}.\n`,
      );
      return;
    }
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
  getArchiveWeekWindows,
  archiveWeeklyUsage,
  buildWeeklySnapshot,
};
