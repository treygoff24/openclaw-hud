const fs = require("fs");
const path = require("path");
const express = require("express");
const { Router } = require("express");
const {
  OPENCLAW_HOME,
  safeJSON,
  safeJSON5,
  stripSecrets,
} = require("../lib/helpers");
const { mapGatewayError } = require("../lib/gateway-compat/error-map");
const { requireLocalOrigin } = require("../lib/gateway-compat/origin-policy");
const {
  TOGGLE_LOOKUP_LIMIT,
  listCronJobs,
  addCronJob,
  updateCronJob,
  removeCronJob,
  buildCronPatchFromLegacyBody,
  normalizeCronListPayload,
} = require("../lib/gateway-compat/contracts/cron");

const router = Router();

const JOB_ID_RE = /^[a-zA-Z0-9_-]+$/;

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isValidJobId(value) {
  return JOB_ID_RE.test(value);
}

function toIntSafe(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? Math.max(0, Math.floor(candidate)) : fallback;
}

function enrichCronJobReadModel(job, defaultModel) {
  const source = isObject(job) ? job : {};
  const payload = isObject(source.payload) ? source.payload : {};
  const modelOverride = source.model || payload.model || null;
  return stripSecrets(
    Object.assign({}, source, {
      payload,
      defaultModel: defaultModel || "unknown",
      modelOverride: modelOverride || null,
      usesDefaultModel: !modelOverride,
    }),
  );
}

function fallbackCronDiagnostics(reason, status, message) {
  return [
    {
      code: reason || "CRON_LIST_FALLBACK",
      message: message || "Cron list gateway path is unavailable.",
      remediation: "Verify gateway is reachable and OpenClaw is running with cron RPC enabled.",
    },
  ];
}

function readCronJobsFromDisk(mappedError = null) {
  const jobsPath = path.join(OPENCLAW_HOME, "cron", "jobs.json");
  const config = safeJSON5(path.join(OPENCLAW_HOME, "config", "source-of-truth.json5"));
  const defaultModel = config?.agents?.defaults?.model?.primary || "unknown";

  const jobsPayload = safeJSON(jobsPath);
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  const fallbackMessage =
    (mappedError && typeof mappedError.message === "string" && mappedError.message.trim()) ||
    "Gateway list RPC unavailable.";

  return {
    jobs: jobs.map((job) => enrichCronJobReadModel(job, defaultModel)),
    meta: {
      gatewayAvailable: false,
      source: "fallback",
      status: "degraded",
      diagnostics: fallbackCronDiagnostics(
        "CRON_LIST_FALLBACK",
        mappedError?.code || "UNAVAILABLE",
        fallbackMessage,
      ),
    },
    total: jobs.length,
    offset: 0,
    limit: 50,
    hasMore: false,
    nextOffset: null,
  };
}

function sendGatewayError(res, err) {
  const mapped = mapGatewayError(err || {});
  const status = Number.isFinite(mapped.status) ? mapped.status : 502;
  const errorMessage =
    typeof mapped.message === "string" && mapped.message.trim() ? mapped.message : "Gateway error";
  return res.status(status).json({
    error: errorMessage,
    code: mapped.code || "GATEWAY_ERROR",
    reason: mapped.reason || "gateway_error",
    rawCode: mapped.rawCode,
    rawStatus: mapped.rawStatus,
  });
}

function shouldFallbackToLocal(mappedError) {
  if (mappedError?.code === "UNAVAILABLE") return true;
  if (mappedError?.status === 503) return true;
  if (/gateway token (is )?not configured|gateway token missing|token not configured/i.test(mappedError?.message || ""))
    return true;
  if (/unreachable|connection|timeout|econn|eai_again|unavailable/i.test(mappedError?.message || ""))
    return true;
  return false;
}

router.get("/api/cron", async (req, res) => {
  try {
    const payload = await listCronJobs();
    const normalized = normalizeCronListPayload(payload);
    const jobs = normalized.jobs.map((job) => {
      const payloadModel = isObject(job?.payload) ? job.payload : {};
      const defaultModel = "unknown";
      return enrichCronJobReadModel(Object.assign({}, job, { payload: payloadModel }), defaultModel);
    });

    return res.json(Object.assign({}, normalized, {
      jobs,
      meta: Object.assign({}, normalized.meta, {
        gatewayAvailable: true,
        diagnostics: [],
      }),
    }));
  } catch (err) {
    const mapped = mapGatewayError(err || {});
    if (shouldFallbackToLocal(mapped)) {
      const fallback = readCronJobsFromDisk(mapped);
      return res.json(fallback);
    }
    return sendGatewayError(res, err);
  }
});

router.post("/api/cron", requireLocalOrigin, express.json(), async (req, res) => {
  const body = isObject(req.body) ? req.body : {};
  try {
    const result = await addCronJob(body, { connectScopes: ["operator.admin"] });
    res.json(result);
  } catch (err) {
    return sendGatewayError(res, err);
  }
});

router.put("/api/cron/:jobId", requireLocalOrigin, express.json(), async (req, res) => {
  const jobId = req.params.jobId;
  if (!isValidJobId(jobId)) {
    return res.status(400).json({ error: "Invalid job ID" });
  }

  const body = isObject(req.body) ? req.body : {};
  const patch = isObject(body.patch) ? body.patch : buildCronPatchFromLegacyBody(body);
  if (!patch || Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "Update patch is required" });
  }

  try {
    const job = await updateCronJob({ id: jobId, patch }, { connectScopes: ["operator.admin"] });
    return res.json({ ok: true, job });
  } catch (err) {
    const mapped = mapGatewayError(err || {});
    if (mapped.code === "NOT_FOUND") {
      return res.status(404).json({
        error: mapped.message || "Cron job not found",
        code: mapped.code,
        reason: mapped.reason,
      });
    }
    return sendGatewayError(res, err);
  }
});

router.post("/api/cron/:jobId/toggle", requireLocalOrigin, async (req, res) => {
  const jobId = req.params.jobId;
  if (!isValidJobId(jobId)) {
    return res.status(400).json({ error: "Invalid job ID" });
  }

  try {
    const listResult = await listCronJobs(
      {
        includeDisabled: true,
        limit: TOGGLE_LOOKUP_LIMIT,
        offset: 0,
        enabled: "all",
        sortBy: "nextRunAtMs",
        sortDir: "asc",
      },
      { connectScopes: ["operator.admin"] },
    );
    const normalized = normalizeCronListPayload(listResult);
    const match = (normalized.jobs || []).find((j) => j && j.id === jobId);
    if (!match) {
      return res.status(404).json({ error: "Cron job not found" });
    }

    const job = await updateCronJob(
      { id: jobId, patch: { enabled: !Boolean(match.enabled) } },
      { connectScopes: ["operator.admin"] },
    );

    return res.json({ ok: true, job });
  } catch (err) {
    const mapped = mapGatewayError(err || {});
    if (mapped.code === "NOT_FOUND") {
      return res.status(404).json({
        error: mapped.message || "Cron job not found",
        code: mapped.code,
        reason: mapped.reason,
      });
    }
    return sendGatewayError(res, err);
  }
});

router.delete("/api/cron/:jobId", requireLocalOrigin, async (req, res) => {
  const jobId = req.params.jobId;
  if (!isValidJobId(jobId)) {
    return res.status(400).json({ error: "Invalid job ID" });
  }

  try {
    const result = await removeCronJob(jobId, { connectScopes: ["operator.admin"] });
    return res.json(result);
  } catch (err) {
    if (mapGatewayError(err || {}).code === "NOT_FOUND") {
      return res.status(404).json({
        error: "Cron job not found",
        code: "NOT_FOUND",
        reason: "not_found",
      });
    }
    return sendGatewayError(res, err);
  }
});

module.exports = router;
