const { callGatewayMethod } = require("../client");

const DEFAULT_LIST_PARAMS = Object.freeze({
  includeDisabled: true,
  limit: 50,
  offset: 0,
  enabled: "all",
  sortBy: "nextRunAtMs",
  sortDir: "asc",
});

const TOGGLE_LOOKUP_LIMIT = 200;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function normalizeNumber(value, fallback = 0) {
  const candidate = Number(value);
  if (!Number.isFinite(candidate) || candidate < 0) return fallback;
  return Math.floor(candidate);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeSortDir(value) {
  const v = normalizeText(value);
  if (v === "asc" || v === "desc") return v;
  return DEFAULT_LIST_PARAMS.sortDir;
}

function normalizeEnabledValue(value) {
  if (value === "all") return "all";
  if (value === true) return true;
  if (value === false) return false;
  return DEFAULT_LIST_PARAMS.enabled;
}

function buildCronListParams(overrides = {}) {
  const params = Object.assign({}, DEFAULT_LIST_PARAMS);
  if (!isObject(overrides)) return params;

  if (typeof overrides.includeDisabled === "boolean") {
    params.includeDisabled = overrides.includeDisabled;
  }

  params.limit = normalizeNumber(overrides.limit, params.limit);
  params.offset = normalizeNumber(overrides.offset, params.offset);

  const enabled = normalizeEnabledValue(overrides.enabled);
  if (enabled !== undefined) params.enabled = enabled;

  const sortBy = normalizeText(overrides.sortBy);
  if (sortBy) params.sortBy = sortBy;

  params.sortDir = normalizeSortDir(overrides.sortDir);

  if (typeof overrides.query === "string") {
    const query = overrides.query.trim();
    if (query) params.query = query;
  }

  return params;
}

function normalizeCronPayloadObject(value) {
  return isObject(value) ? Object.assign({}, value) : {};
}

function normalizeCronPatchFromLegacy(body = {}) {
  if (!isObject(body)) return {};

  if (isObject(body.patch)) {
    return normalizeCronPayloadObject(body.patch);
  }

  const patch = {};
  const legacyKeys = [
    "name",
    "enabled",
    "agentId",
    "schedule",
    "sessionTarget",
    "wakeMode",
    "delivery",
    "payload",
  ];
  for (const key of legacyKeys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (key === "payload") {
      patch.payload = value == null ? {} : isObject(value) ? value : {};
      continue;
    }
    if (key === "enabled") {
      patch.enabled = normalizeBoolean(value);
      continue;
    }
    if (
      key === "name" ||
      key === "schedule" ||
      key === "sessionTarget" ||
      key === "wakeMode" ||
      key === "delivery"
    ) {
      if (value !== undefined) patch[key] = value;
      continue;
    }
    patch[key] = value;
  }

  const sessionTarget = normalizeText(patch.sessionTarget);
  if (sessionTarget && isObject(patch.payload)) {
    const kind = patch.payload.kind;
    if (sessionTarget === "main" && kind !== "systemEvent") {
      patch.payload = Object.assign({}, patch.payload, { kind: "systemEvent" });
    }
    if (sessionTarget === "isolated" && kind !== "agentTurn") {
      patch.payload = Object.assign({}, patch.payload, { kind: "agentTurn" });
    }
  }

  return patch;
}

function normalizeCronListPayload(payload) {
  const sourcePayload = isObject(payload) ? payload : {};
  const jobs = Array.isArray(sourcePayload.jobs) ? sourcePayload.jobs : [];
  const limit = normalizeNumber(sourcePayload.limit, DEFAULT_LIST_PARAMS.limit);
  const offset = normalizeNumber(sourcePayload.offset, DEFAULT_LIST_PARAMS.offset);
  const total = normalizeNumber(sourcePayload.total, jobs.length);
  const hasMore = sourcePayload.hasMore === true;
  const nextOffset = sourcePayload.nextOffset == null ? null : Number(sourcePayload.nextOffset);

  return {
    jobs,
    total,
    offset,
    limit,
    hasMore,
    nextOffset: Number.isFinite(nextOffset) ? nextOffset : null,
    meta: Object.assign(
      { source: "gateway" },
      isObject(sourcePayload.meta) ? sourcePayload.meta : {},
    ),
  };
}

function normalizeCronId(value) {
  return normalizeText(value);
}

async function listCronJobs(params = {}, options = {}) {
  return callGatewayMethod("cron.list", buildCronListParams(params), options);
}

async function addCronJob(payload = {}, options = {}) {
  return callGatewayMethod("cron.add", normalizeCronPayloadObject(payload), options);
}

async function updateCronJob(request = {}, options = {}) {
  const id = normalizeCronId(request.id || request.jobId);
  if (!id) {
    throw new Error("Invalid job id");
  }

  const patch =
    isObject(request.patch) && !Array.isArray(request.patch)
      ? request.patch
      : normalizeCronPatchFromLegacy(request);

  return callGatewayMethod(
    "cron.update",
    {
      id,
      patch,
    },
    options,
  );
}

async function removeCronJob(jobId, options = {}) {
  const id = normalizeCronId(jobId);
  if (!id) {
    throw new Error("Invalid job id");
  }
  return callGatewayMethod("cron.remove", { id }, options);
}

module.exports = {
  TOGGLE_LOOKUP_LIMIT,
  DEFAULT_LIST_PARAMS,
  buildCronListParams,
  buildCronPatchFromLegacyBody: normalizeCronPatchFromLegacy,
  normalizeCronListPayload,
  listCronJobs,
  addCronJob,
  updateCronJob,
  removeCronJob,
};
