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
const PERF_FILE_DIR = PERF_LOG_WRITER_DEFAULTS.dir;
const PERF_UNAVAILABLE_ERROR = 'Performance diagnostics storage unavailable';

function createNullProtoObject() {
  return Object.create(null);
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

const defaultPerfLogWriter = createPerfLogWriter(PERF_LOG_WRITER_DEFAULTS);
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
            }
          }
        }
      }

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
        },
        metrics,
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

  const sanitizedEvents = sanitizePerfEventBatch(
    validation.events.map((event) => stripSecrets(event)),
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
        },
        metrics: summary?.metrics && typeof summary.metrics === 'object' ? summary.metrics : {},
      },
    });
  } catch (error) {
    const now = new Date().toISOString();
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
        },
        metrics: {},
      },
    });
  }
});

router.setPerfLogWriter = setPerfLogWriter;
router.setPerfExporter = setPerfExporter;

module.exports = router;
