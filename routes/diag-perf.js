const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { Router } = require('express');
const { stripSecrets } = require('../lib/helpers');
const {
  createPerfLogWriter,
  PERF_LOG_WRITER_DEFAULTS,
  sanitizePerfEvent,
  sanitizePerfEventBatch,
} = require('../lib/perf-log-writer');

const router = Router();

const PERF_ROUTE_PATH = '/api/diag/perf';
const PERF_EXPORT_ROUTE_PATH = `${PERF_ROUTE_PATH}/export`;
const PERF_SYSTEM_ROUTE_PATH = `${PERF_ROUTE_PATH}/system`;
const PERF_FILE_DIR = PERF_LOG_WRITER_DEFAULTS.dir;
const DEFAULT_PERF_LOG_OPTIONS = {
  dir: PERF_LOG_WRITER_DEFAULTS.dir,
  maxBytes: PERF_LOG_WRITER_DEFAULTS.maxBytes,
  maxFiles: PERF_LOG_WRITER_DEFAULTS.maxFiles,
};
const PERF_UNAVAILABLE_ERROR = 'Performance diagnostics storage unavailable';

function createNullProtoObject() {
  return Object.create(null);
}

function isSafeObjectKey(value) {
  return typeof value === 'string' && value.trim().length > 0 && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

function clampSafeText(value, maxLength = 128) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (maxLength > 0 && trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength);
  }
  return trimmed;
}

function buildSafeEvents(rawLines) {
  const events = [];
  for (const rawLine of rawLines) {
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch (_error) {
      continue;
    }

    const sanitized = sanitizePerfEvent(parsed);
    if (sanitized && typeof sanitized === 'object') {
      events.push(sanitized);
    }
  }
  return events;
}

const defaultPerfLogWriter = createPerfLogWriter(DEFAULT_PERF_LOG_OPTIONS);
let perfLogWriter = defaultPerfLogWriter;
let perfExporter = createPerfExporter(perfLogWriter);

function parseValidTimestamp(ts) {
  if (typeof ts !== 'string') {
    return null;
  }

  const parsed = Date.parse(ts);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

function createRunLevelSloDefaults() {
  return {
    fetchAll: {
      p95MsProxy: null,
      p99MsProxy: null,
    },
    tickToPaint: {
      p95MsProxy: null,
    },
    tail: {
      over500msCount: 0,
    },
  };
}

function toFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function collectRunLevelSample(rawField, fallbackCount = 1) {
  const parsedCount = toPositiveInteger(rawField?.count, fallbackCount);
  const sampleCount = Math.max(parsedCount, 1);
  const averagedValue =
    sampleCount > 0 ? toFiniteNumber(rawField?.sum, null) / sampleCount : null;
  const sampleValue = toFiniteNumber(
    rawField?.last,
    toFiniteNumber(averagedValue, toFiniteNumber(rawField?.max, null)),
  );
  if (!Number.isFinite(sampleValue) || sampleValue < 0) {
    return null;
  }
  return {
    value: sampleValue,
    count: 1,
  };
}

function weightedPercentileFromSamples(samples, percentile) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return null;
  }

  const ratio = toFiniteNumber(percentile, null);
  if (!Number.isFinite(ratio)) {
    return null;
  }
  const clampedRatio = Math.min(100, Math.max(0, ratio));

  const normalized = samples
    .filter((sample) => Number.isFinite(sample?.value) && Number.isFinite(sample?.count))
    .map((sample) => ({
      value: sample.value,
      count: Math.max(1, Math.floor(sample.count)),
    }))
    .filter((sample) => sample.count > 0)
    .sort((left, right) => left.value - right.value);

  if (normalized.length === 0) {
    return null;
  }

  const totalCount = normalized.reduce((acc, sample) => acc + sample.count, 0);
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    return null;
  }

  const targetIndex = Math.ceil((clampedRatio / 100) * totalCount);
  let cursor = 0;
  for (const sample of normalized) {
    cursor += sample.count;
    if (cursor >= targetIndex) {
      return sample.value;
    }
  }
  return normalized[normalized.length - 1].value;
}

function appendMetric(summary, metricName, fieldName, value) {
  if (!isSafeObjectKey(metricName) || !isSafeObjectKey(fieldName)) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) return;

  if (!Object.prototype.hasOwnProperty.call(summary, metricName)) {
    summary[metricName] = createNullProtoObject();
  }

  summary[metricName][fieldName] = {
    count: 1,
    sum: value,
    min: value,
    max: value,
    last: value,
  };
}

function mapSystemSamplePayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid payload: expected object' };
  }

  const runId = clampSafeText(body.runId, 128);
  if (runId === null) {
    return { ok: false, error: 'Invalid payload: runId is required for system samples' };
  }

  const source = clampSafeText(body.source, 64) || 'system-viewer';
  const ts =
    typeof body.ts === 'string' ? body.ts : new Date().toISOString();

  const summary = createNullProtoObject();
  const power = body.power && typeof body.power === 'object' ? body.power : null;
  const thermal = body.thermal && typeof body.thermal === 'object' ? body.thermal : null;
  const capture = body.capture && typeof body.capture === 'object' ? body.capture : null;

  const appendIfNumber = (metricName, fieldName, value) => {
    appendMetric(summary, metricName, fieldName, Number.isFinite(Number(value)) ? Number(value) : NaN);
  };

  if (power) {
    appendIfNumber('system.power', 'gpuPowerW', power.gpuPowerW);
    appendIfNumber('system.power', 'gpuPowerMW', power.gpuPowerMW);
    appendIfNumber('system.power', 'cpuPowerW', power.cpuPowerW);
    appendIfNumber('system.power', 'packagePowerW', power.packagePowerW);
  }

  if (thermal) {
    appendIfNumber('system.thermal', 'cpuTempC', thermal.cpuTempC);
    appendIfNumber('system.thermal', 'gpuTempC', thermal.gpuTempC);
    appendIfNumber('system.thermal', 'skinTempC', thermal.skinTempC);
    appendIfNumber('system.thermal', 'thermalPressure', thermal.thermalPressure);
  }

  if (capture) {
    appendIfNumber('system.capture', 'powermetricsAttempts', capture.powermetricsAttempts);
    appendIfNumber('system.capture', 'powermetricsSuccesses', capture.powermetricsSuccesses);
    appendIfNumber('system.capture', 'powermetricsFailures', capture.powermetricsFailures);
    appendIfNumber('system.capture', 'powermetricsUnavailable', capture.powermetricsUnavailable);
    appendIfNumber('system.capture', 'thermlogAttempts', capture.thermlogAttempts);
    appendIfNumber('system.capture', 'thermlogSuccesses', capture.thermlogSuccesses);
    appendIfNumber('system.capture', 'thermlogFailures', capture.thermlogFailures);
    appendIfNumber('system.capture', 'thermlogUnavailable', capture.thermlogUnavailable);
  }

  const summaryKeys = Object.keys(summary);
  if (summaryKeys.length === 0) {
    return { ok: false, error: 'Invalid payload: no recognized system metrics' };
  }

  return {
    ok: true,
    events: [
      {
        ts,
        runId,
        source,
        summary,
      },
    ],
  };
}

function createPerfExporter(writer) {
  function collectSegmentEntries() {
    const baseName = writer?.config?.baseName || 'hud-perf';
    const dir = writer?.config?.dir || PERF_FILE_DIR;
    const prefix = `${baseName}-`;
    let entries = [];

    try {
      entries = fs.readdirSync(dir);
    } catch (_error) {
      return [];
    }

    const logs = entries
      .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
      .map((name) => ({ name, path: path.join(dir, name) }))
      .filter((entry) => {
        try {
          return fs.statSync(entry.path).isFile();
        } catch (_error) {
          return false;
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return logs.map((entry) => entry.path);
  }

  return {
    async buildSummary() {
      let fromTs = null;
      let toTs = null;
      let eventCount = 0;
      const batchIds = new Set();
      const metrics = createNullProtoObject();
      const runIdCounts = createNullProtoObject();
      const sources = createNullProtoObject();
      const runLevelSlo = createRunLevelSloDefaults();
      const fetchAllSamples = [];
      const tickToPaintSamples = [];
      let explicitOver500Count = 0;
      let sawExplicitOver500Metric = false;
      let fallbackOver500BucketCount = 0;

      const segmentPaths = collectSegmentEntries();
      for (const filePath of segmentPaths) {
        let raw;
        try {
          raw = fs.readFileSync(filePath, 'utf8');
        } catch (_error) {
          continue;
        }

        const lines = String(raw).split('\n').map((line) => line.trim()).filter(Boolean);
        for (const parsed of buildSafeEvents(lines)) {
          eventCount += 1;

          const eventTs = parseValidTimestamp(parsed.ts);
          if (eventTs !== null) {
            if (fromTs === null || eventTs < fromTs) {
              fromTs = eventTs;
            }
            if (toTs === null || eventTs > toTs) {
              toTs = eventTs;
            }
          }

          if (parsed._batchId) {
            batchIds.add(String(parsed._batchId));
          }

          if (typeof parsed.runId === 'string' && isSafeObjectKey(parsed.runId)) {
            runIdCounts[parsed.runId] = (runIdCounts[parsed.runId] || 0) + 1;
          }

          if (typeof parsed.source === 'string' && isSafeObjectKey(parsed.source)) {
            sources[parsed.source] = (sources[parsed.source] || 0) + 1;
          }

          const summary = parsed.summary;
          if (!summary) {
            continue;
          }

          for (const [metricName, rawFields] of Object.entries(summary)) {
            if (!rawFields || typeof rawFields !== 'object') continue;
            if (!Object.prototype.hasOwnProperty.call(metrics, metricName)) {
              metrics[metricName] = createNullProtoObject();
            }
            const targetFields = metrics[metricName];

            for (const [fieldName, rawField] of Object.entries(rawFields)) {
              if (!rawField || typeof rawField !== 'object') continue;

              const next = {
                count: Number(rawField.count) || 0,
                sum: Number(rawField.sum) || 0,
                min: rawField.min != null ? Number(rawField.min) : Number(rawField.last) || 0,
                max: rawField.max != null ? Number(rawField.max) : Number(rawField.last) || 0,
                last: Number(rawField.last) || 0,
              };

              const existing = targetFields[fieldName];
              if (!existing) {
                targetFields[fieldName] = {
                  count: next.count,
                  sum: next.sum,
                  min: next.min,
                  max: next.max,
                  last: next.last,
                };
                if (metricName === 'fetchAll.finish' && fieldName === 'durationMs') {
                  const sample = collectRunLevelSample(rawField, 1);
                  if (sample) {
                    fetchAllSamples.push(sample);
                    if (sample.value > 500) {
                      fallbackOver500BucketCount += 1;
                    }
                  }
                }
                if (metricName === 'fetchAll.finish' && fieldName === 'over500ms') {
                  sawExplicitOver500Metric = true;
                  explicitOver500Count += toPositiveInteger(rawField?.sum, toPositiveInteger(rawField?.last, 0));
                }
                if (metricName === 'tickToPaint' && fieldName === 'durationMs') {
                  const sample = collectRunLevelSample(rawField, 1);
                  if (sample) {
                    tickToPaintSamples.push(sample);
                  }
                }
                continue;
              }

              const merged = {
                count: (existing.count || 0) + next.count,
                sum: (existing.sum || 0) + next.sum,
                min: Math.min(existing.min, next.min),
                max: Math.max(existing.max, next.max),
                last: next.last,
              };
              targetFields[fieldName] = merged;
              if (metricName === 'fetchAll.finish' && fieldName === 'durationMs') {
                const sample = collectRunLevelSample(rawField, 1);
                if (sample) {
                  fetchAllSamples.push(sample);
                  if (sample.value > 500) {
                    fallbackOver500BucketCount += 1;
                  }
                }
              }
              if (metricName === 'fetchAll.finish' && fieldName === 'over500ms') {
                sawExplicitOver500Metric = true;
                explicitOver500Count += toPositiveInteger(rawField?.sum, toPositiveInteger(rawField?.last, 0));
              }
              if (metricName === 'tickToPaint' && fieldName === 'durationMs') {
                const sample = collectRunLevelSample(rawField, 1);
                if (sample) {
                  tickToPaintSamples.push(sample);
                }
              }
            }
          }
        }
      }

      runLevelSlo.fetchAll.p95MsProxy = weightedPercentileFromSamples(fetchAllSamples, 95);
      runLevelSlo.fetchAll.p99MsProxy = weightedPercentileFromSamples(fetchAllSamples, 99);
      runLevelSlo.tickToPaint.p95MsProxy = weightedPercentileFromSamples(tickToPaintSamples, 95);
      runLevelSlo.tail.over500msCount = sawExplicitOver500Metric
        ? explicitOver500Count
        : fallbackOver500BucketCount;

      const now = new Date().toISOString();
      return {
        generatedAt: now,
        range: {
          from: fromTs || now,
          to: toTs || now,
        },
        totals: {
          batches: Math.max(eventCount > 0 ? batchIds.size : 0, 0),
          events: eventCount,
          runs: Object.keys(runIdCounts).length,
          sources: Object.keys(sources).length,
        },
        metrics,
        runLevelSlo,
        runIds: Object.keys(runIdCounts),
        sourceCounts: sources,
      };
    },
  };
}

function setPerfLogWriter(nextWriter) {
  if (!nextWriter) {
    perfLogWriter = defaultPerfLogWriter;
    return;
  }

  if (typeof nextWriter.appendBatch === 'function') {
    perfLogWriter = nextWriter;
    return;
  }

  throw new Error('perfLogWriter must expose appendBatch(eventBatch)');
}

function setPerfExporter(nextExporter) {
  if (!nextExporter) {
    perfExporter = createPerfExporter(perfLogWriter);
    return;
  }

  if (typeof nextExporter.buildSummary === 'function') {
    perfExporter = nextExporter;
    return;
  }

  throw new Error('perfExporter must expose buildSummary()');
}

function validatePerfPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid payload: expected object' };
  }

  if (!Array.isArray(body.events)) {
    return { ok: false, error: 'Invalid payload: events must be an array' };
  }

  if (body.events.length === 0) {
    return { ok: true, events: [] };
  }

  for (const entry of body.events) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Invalid payload: each event must be an object' };
    }
  }

  return { ok: true, events: body.events };
}

router.post(PERF_ROUTE_PATH, express.json(), async (req, res) => {
  const validation = validatePerfPayload(req.body);
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const envelopeSource = clampSafeText(req.body.source, 64);
  const envelopeRunId = clampSafeText(req.body.runId, 128);
  const normalizedEvents = validation.events.map((event) => {
    const clonedEvent = event && typeof event === 'object' ? event : {};
    if (envelopeSource && !Object.prototype.hasOwnProperty.call(clonedEvent, 'source')) {
      clonedEvent.source = envelopeSource;
    }
    if (envelopeRunId && !Object.prototype.hasOwnProperty.call(clonedEvent, 'runId')) {
      clonedEvent.runId = envelopeRunId;
    }
    return clonedEvent;
  });

  const sanitizedEvents = sanitizePerfEventBatch(
    normalizedEvents.map((event) => stripSecrets(event)),
  );

  if (perfLogWriter && perfLogWriter.isAvailable === false) {
    return res.status(503).json({
      ok: false,
      error: PERF_UNAVAILABLE_ERROR,
      reason: perfLogWriter.unavailableReason || null,
    });
  }

  try {
    const summary = await perfLogWriter.appendBatch(sanitizedEvents);
    return res.status(202).json({
      ok: true,
      accepted: sanitizedEvents.length,
      written: summary?.written,
      bytes: summary?.bytes,
    });
  } catch (error) {
    if (error && error.code === 'E_PERF_EVENT_TOO_LARGE') {
      return res.status(413).json({
        ok: false,
        code: 'E_PERF_EVENT_TOO_LARGE',
        error: error instanceof Error ? error.message : 'Serialized performance event exceeds maxBytes policy',
        repairable: true,
      });
    }

    if (
      perfLogWriter?.isAvailable === false ||
      (error && error.code === 'E_PERF_LOG_WRITER_UNAVAILABLE')
    ) {
      return res.status(503).json({
        ok: false,
        error: PERF_UNAVAILABLE_ERROR,
        reason: perfLogWriter?.unavailableReason || (error && error.message) || null,
      });
    }

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to persist performance events',
    });
  }
});

router.get(PERF_EXPORT_ROUTE_PATH, async (_req, res) => {
  try {
    const summary = await perfExporter.buildSummary();

    return res.json({
      ok: true,
      summary: {
        generatedAt: summary?.generatedAt || new Date().toISOString(),
        range: {
          from:
            summary?.range && typeof summary.range.from === 'string' ? summary.range.from : new Date().toISOString(),
          to:
            summary?.range && typeof summary.range.to === 'string' ? summary.range.to : new Date().toISOString(),
        },
        totals: {
          batches:
            summary?.totals && Number.isFinite(summary.totals.batches)
              ? summary.totals.batches
              : 0,
          events:
            summary?.totals && Number.isFinite(summary.totals.events)
              ? summary.totals.events
              : 0,
          runs:
            summary?.totals && Number.isFinite(summary.totals.runs)
              ? summary.totals.runs
              : 0,
          sources:
            summary?.totals && Number.isFinite(summary.totals.sources)
              ? summary.totals.sources
              : 0,
        },
        metrics: summary?.metrics && typeof summary.metrics === 'object' ? summary.metrics : {},
        runLevelSlo:
          summary?.runLevelSlo && typeof summary.runLevelSlo === 'object'
            ? summary.runLevelSlo
            : createRunLevelSloDefaults(),
        runIds: Array.isArray(summary?.runIds) ? summary.runIds : [],
        sourceCounts: summary?.sourceCounts && typeof summary.sourceCounts === 'object' ? summary.sourceCounts : {},
      },
    });
  } catch (error) {
    const now = new Date().toISOString();
    const runLevelSlo = createRunLevelSloDefaults();
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to build performance summary',
      summary: {
        generatedAt: now,
        range: {
          from: now,
          to: now,
        },
        totals: {
          batches: 0,
          events: 0,
          runs: 0,
          sources: 0,
        },
        runLevelSlo,
        metrics: {},
        runIds: [],
        sourceCounts: {},
      },
    });
  }
});

router.post(PERF_SYSTEM_ROUTE_PATH, express.json(), async (req, res) => {
  const mapped = mapSystemSamplePayload(req.body);
  if (!mapped.ok) {
    return res.status(400).json({ ok: false, error: mapped.error });
  }

  if (perfLogWriter && perfLogWriter.isAvailable === false) {
    return res.status(503).json({
      ok: false,
      error: PERF_UNAVAILABLE_ERROR,
      reason: perfLogWriter.unavailableReason || null,
    });
  }

  try {
    const summary = await perfLogWriter.appendBatch(mapped.events);
    return res.status(202).json({
      ok: true,
      accepted: mapped.events.length,
      written: summary?.written,
      bytes: summary?.bytes,
      runId: mapped.events[0].runId,
      source: mapped.events[0].source,
    });
  } catch (error) {
    if (error && error.code === 'E_PERF_EVENT_TOO_LARGE') {
      return res.status(413).json({
        ok: false,
        code: 'E_PERF_EVENT_TOO_LARGE',
        error: error instanceof Error ? error.message : 'Serialized performance event exceeds maxBytes policy',
        repairable: true,
      });
    }

    if (
      perfLogWriter?.isAvailable === false ||
      (error && error.code === 'E_PERF_LOG_WRITER_UNAVAILABLE')
    ) {
      return res.status(503).json({
        ok: false,
        error: PERF_UNAVAILABLE_ERROR,
        reason: perfLogWriter?.unavailableReason || (error && error.message) || null,
      });
    }

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to persist performance events',
    });
  }
});

router.setPerfLogWriter = setPerfLogWriter;
router.setPerfExporter = setPerfExporter;

module.exports = router;
