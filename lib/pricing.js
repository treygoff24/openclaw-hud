const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME, safeJSON, safeJSON5 } = require('./helpers');
const { toFiniteNumber } = require('./number');

const TOKENS_PER_MILLION = 1_000_000;

function loadPricingCatalog() {
  const primary = safeJSON(path.join(OPENCLAW_HOME, 'openclaw.json'));
  const legacy = primary ? null : safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const config = primary || legacy || {};
  return buildPricingCatalog(config);
}

function getPricingConfigPaths() {
  return [
    path.join(OPENCLAW_HOME, 'openclaw.json'),
    path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'),
  ];
}

function getPricingConfigFingerprint() {
  const parts = [];

  for (const filePath of getPricingConfigPaths()) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      parts.push(`${filePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      // File missing or unreadable: ignore and continue.
    }
  }

  return parts.join('|') || 'none';
}

function buildPricingCatalog(config) {
  const providers = config?.models?.providers;
  const byProvider = {};

  if (!providers || typeof providers !== 'object') {
    return { byProvider };
  }

  for (const [provider, providerConfig] of Object.entries(providers)) {
    const models = Array.isArray(providerConfig?.models) ? providerConfig.models : [];
    const modelIndex = new Map();

    for (const modelConfig of models) {
      const id = typeof modelConfig?.id === 'string' ? modelConfig.id.trim() : '';
      const rates = normalizeRates(modelConfig?.cost);
      if (!id || !rates) continue;

      for (const key of getModelLookupKeys(provider, id)) {
        modelIndex.set(key, rates);
      }
    }

    byProvider[provider] = modelIndex;
  }

  return { byProvider };
}

function normalizeRates(cost) {
  if (!cost || typeof cost !== 'object') return null;

  const hasAnyRateField =
    Object.prototype.hasOwnProperty.call(cost, 'input') ||
    Object.prototype.hasOwnProperty.call(cost, 'output') ||
    Object.prototype.hasOwnProperty.call(cost, 'cacheRead') ||
    Object.prototype.hasOwnProperty.call(cost, 'cacheWrite');

  if (!hasAnyRateField) return null;

  return {
    input: toFiniteNumber(cost.input),
    output: toFiniteNumber(cost.output),
    cacheRead: toFiniteNumber(cost.cacheRead),
    cacheWrite: toFiniteNumber(cost.cacheWrite),
  };
}

function getModelLookupKeys(provider, modelId) {
  const model = typeof modelId === 'string' ? modelId.trim() : '';
  if (!model) return [];

  const keys = new Set([model]);
  const prefixed = `${provider}/${model}`;
  keys.add(prefixed);

  if (model.startsWith(`${provider}/`)) {
    keys.add(model.slice(provider.length + 1));
  }

  const short = model.split('/').pop();
  if (short) keys.add(short);

  return [...keys];
}

function resolveRates(catalog, row) {
  const provider = typeof row?.provider === 'string' ? row.provider.trim() : '';
  const model = typeof row?.model === 'string' ? row.model.trim() : '';
  if (!provider || !model) return null;

  const providerMap = catalog?.byProvider?.[provider];
  if (!(providerMap instanceof Map)) return null;

  for (const key of getModelLookupKeys(provider, model)) {
    if (providerMap.has(key)) return providerMap.get(key);
  }

  return null;
}

function getMissingPricingId(row) {
  const provider = typeof row?.provider === 'string' && row.provider.trim() ? row.provider.trim() : 'unknown';
  const model = typeof row?.model === 'string' && row.model.trim() ? row.model.trim() : 'unknown';
  if (model.startsWith(`${provider}/`)) return model;
  return `${provider}/${model}`;
}

function computeRowCost(row, rates) {
  const inputTokens = toFiniteNumber(row?.inputTokens);
  const outputTokens = toFiniteNumber(row?.outputTokens);
  const cacheReadTokens = toFiniteNumber(row?.cacheReadTokens);
  const cacheWriteTokens = toFiniteNumber(row?.cacheWriteTokens);

  return (
    (inputTokens * rates.input +
      outputTokens * rates.output +
      cacheReadTokens * rates.cacheRead +
      cacheWriteTokens * rates.cacheWrite) /
    TOKENS_PER_MILLION
  );
}

function repriceModelUsageRows(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const catalog = options.catalog || loadPricingCatalog();
  const missingPricingModels = new Set();

  const repricedRows = sourceRows.map((row) => {
    const rates = resolveRates(catalog, row);
    if (!rates) {
      missingPricingModels.add(getMissingPricingId(row));
      return { ...row, totalCost: 0 };
    }

    return { ...row, totalCost: computeRowCost(row, rates) };
  });

  return {
    rows: repricedRows,
    missingPricingModels: [...missingPricingModels],
  };
}

module.exports = {
  buildPricingCatalog,
  getPricingConfigFingerprint,
  loadPricingCatalog,
  repriceModelUsageRows,
};
