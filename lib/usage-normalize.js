const { toFiniteNumber } = require("./number");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeModelRow(row) {
  const sourceRow = isObject(row) ? row : {};
  const totals = isObject(sourceRow.totals) ? sourceRow.totals : {};

  const provider =
    typeof sourceRow.provider === "string" && sourceRow.provider.trim()
      ? sourceRow.provider
      : typeof sourceRow.model === "string" && sourceRow.model.includes("/")
        ? sourceRow.model.split("/")[0]
        : "unknown";
  const model =
    typeof sourceRow.model === "string" && sourceRow.model.trim() ? sourceRow.model : "unknown";

  const inputTokens = toFiniteNumber(
    totals.inputTokens ?? totals.input ?? sourceRow.inputTokens ?? sourceRow.input,
  );
  const outputTokens = toFiniteNumber(
    totals.outputTokens ?? totals.output ?? sourceRow.outputTokens ?? sourceRow.output,
  );
  const cacheReadTokens = toFiniteNumber(
    totals.cacheReadTokens ?? totals.cacheRead ?? sourceRow.cacheReadTokens ?? sourceRow.cacheRead,
  );
  const cacheWriteTokens = toFiniteNumber(
    totals.cacheWriteTokens ??
      totals.cacheWrite ??
      sourceRow.cacheWriteTokens ??
      sourceRow.cacheWrite,
  );
  const totalTokens = toFiniteNumber(
    totals.totalTokens ??
      sourceRow.totalTokens ??
      sourceRow.total ??
      inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
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

module.exports = {
  isObject,
  normalizeModelRow,
  collectUsageRows,
};
