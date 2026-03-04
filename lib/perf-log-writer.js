const fs = require('node:fs');
const path = require('node:path');
const { OPENCLAW_HOME } = require('./helpers');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_FILES = 7;
const DEFAULT_SEGMENT_BASE_NAME = 'hud-perf';
const DEFAULT_SEGMENT_DIR = path.join(OPENCLAW_HOME, 'state', 'perf');
const PERF_LOG_WRITER_DEFAULTS = Object.freeze({
  dir: DEFAULT_SEGMENT_DIR,
  baseName: DEFAULT_SEGMENT_BASE_NAME,
  maxBytes: DEFAULT_MAX_BYTES,
  maxFiles: DEFAULT_MAX_FILES,
});
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function createSafeMap() {
  return Object.create(null);
}

function hasSafeKey(key) {
  return typeof key === 'string' && !BANNED_KEYS.has(key);
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sanitizePerfMetricValue(rawMetricValue) {
  if (!rawMetricValue || typeof rawMetricValue !== 'object' || Array.isArray(rawMetricValue)) {
    return null;
  }

  const hasCount = Object.prototype.hasOwnProperty.call(rawMetricValue, 'count');
  const hasSum = Object.prototype.hasOwnProperty.call(rawMetricValue, 'sum');
  const hasMin = Object.prototype.hasOwnProperty.call(rawMetricValue, 'min');
  const hasMax = Object.prototype.hasOwnProperty.call(rawMetricValue, 'max');
  const hasLast = Object.prototype.hasOwnProperty.call(rawMetricValue, 'last');

  if (!hasCount && !hasSum && !hasMin && !hasMax && !hasLast) {
    return null;
  }

  const metricValue = createSafeMap();
  const lastValue = toSafeNumber(rawMetricValue.last);

  metricValue.count = hasCount ? toSafeNumber(rawMetricValue.count) : 0;

  metricValue.sum = hasSum ? toSafeNumber(rawMetricValue.sum) : 0;

  if (hasMin) {
    metricValue.min = toSafeNumber(rawMetricValue.min);
  } else {
    metricValue.min = toSafeNumber(rawMetricValue.min, lastValue);
  }

  if (hasMax) {
    metricValue.max = toSafeNumber(rawMetricValue.max);
  } else {
    metricValue.max = toSafeNumber(rawMetricValue.max, lastValue);
  }

  metricValue.last = toSafeNumber(rawMetricValue.last);
  if (!hasLast && hasMin && hasMax) {
    metricValue.last = metricValue.max;
  }

  return metricValue;
}

function sanitizePerfSummary(rawSummary) {
  if (!rawSummary || typeof rawSummary !== 'object' || Array.isArray(rawSummary)) {
    return null;
  }

  const summary = createSafeMap();
  for (const [metricName, metricValues] of Object.entries(rawSummary)) {
    if (!hasSafeKey(metricName) || !metricValues || typeof metricValues !== 'object' || Array.isArray(metricValues)) {
      continue;
    }

    const safeMetric = createSafeMap();
    for (const [fieldName, rawValue] of Object.entries(metricValues)) {
      if (!hasSafeKey(fieldName)) continue;

      const safeValue = sanitizePerfMetricValue(rawValue);
      if (safeValue) {
        safeMetric[fieldName] = safeValue;
      }
    }

    if (Object.keys(safeMetric).length > 0) {
      summary[metricName] = safeMetric;
    }
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

function sanitizePerfEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return null;
  }

  const event = createSafeMap();

  if (Object.prototype.hasOwnProperty.call(rawEvent, 'ts') && typeof rawEvent.ts === 'string') {
    event.ts = rawEvent.ts;
  }

  if (Object.prototype.hasOwnProperty.call(rawEvent, '_batchId') && typeof rawEvent._batchId === 'string') {
    event._batchId = rawEvent._batchId;
  }

  if (
    Object.prototype.hasOwnProperty.call(rawEvent, 'sessionId') &&
    typeof rawEvent.sessionId === 'string'
  ) {
    event.sessionId = rawEvent.sessionId;
  }

  if (Object.prototype.hasOwnProperty.call(rawEvent, 'summary')) {
    const summary = sanitizePerfSummary(rawEvent.summary);
    if (summary) {
      event.summary = summary;
    } else if (rawEvent.summary && typeof rawEvent.summary === 'object') {
      event.summary = createSafeMap();
    }
  }

  return event;
}

function sanitizePerfEventBatch(events) {
  if (!Array.isArray(events)) return [];

  return events.map((event) => sanitizePerfEvent(event)).filter((event) => event !== null);
}

function createUnavailablePerfLogWriter(config, error) {
  const unavailableReason = error instanceof Error ? error.message : String(error || 'Performance log writer unavailable');
  return {
    unavailableReason,
    appendBatch: async () => {
      const unavailableError = new Error(unavailableReason);
      unavailableError.code = 'E_PERF_LOG_WRITER_UNAVAILABLE';
      throw unavailableError;
    },
    readSegmentPaths: () => [],
    config,
    isAvailable: false,
  };
}

function coercePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function coerceString(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSegmentName(baseName, index) {
  const safeIndex = String(Math.max(1, index)).padStart(6, "0");
  return `${baseName}-${safeIndex}.jsonl`;
}

function discoverSegments(dir, baseName) {
  const escapedBase = escapeRegex(baseName);
  const segmentMatcher = new RegExp(`^${escapedBase}-(\\d+)\\.jsonl$`);

  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (_error) {
    return [];
  }

  const segments = [];
  for (const name of entries) {
    const match = segmentMatcher.exec(name);
    if (!match) continue;
    const index = Number(match[1]);
    const filePath = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (_error) {
      continue;
    }
    if (!stat.isFile()) continue;

    segments.push({
      name,
      index,
      path: filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }

  segments.sort((a, b) => a.index - b.index);
  return segments;
}

function createPerfLogWriter(options = {}) {
  const maxBytes = coercePositiveInt(options.maxBytes, PERF_LOG_WRITER_DEFAULTS.maxBytes);
  const maxFiles = coercePositiveInt(options.maxFiles, PERF_LOG_WRITER_DEFAULTS.maxFiles);
  const baseName = coerceString(options.baseName, PERF_LOG_WRITER_DEFAULTS.baseName);
  const dir = coerceString(options.dir, PERF_LOG_WRITER_DEFAULTS.dir);
  const config = {
    dir,
    baseName,
    maxBytes,
    maxFiles,
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return createUnavailablePerfLogWriter(config, error);
  }

  const segments = discoverSegments(dir, baseName);
  let currentSegmentIndex = 0;
  let currentPath = null;
  let currentSize = 0;

  if (segments.length > 0) {
    const latest = segments[segments.length - 1];
    currentSegmentIndex = latest.index;
    currentPath = latest.path;
    currentSize = latest.size;
  }

  if (currentSegmentIndex <= 0) {
    currentSegmentIndex = 1;
    currentPath = path.join(dir, buildSegmentName(baseName, currentSegmentIndex));
    currentSize = 0;
  }

  let inFlight = Promise.resolve();

  function rotateIfNeeded() {
    currentSegmentIndex += 1;
    currentPath = path.join(dir, buildSegmentName(baseName, currentSegmentIndex));
    currentSize = 0;
  }

  function trimRetention() {
    if (maxFiles <= 0) {
      return;
    }

    const allSegments = discoverSegments(dir, baseName);
    const excess = allSegments.length - maxFiles;
    if (excess <= 0) {
      return;
    }

    for (const segment of allSegments.slice(0, excess)) {
      try {
        fs.unlinkSync(segment.path);
      } catch (_error) {
        // Ignore cleanup failures.
      }
    }
  }

  async function appendBatch(events) {
    const sanitizedEvents = sanitizePerfEventBatch(events);
    if (!Array.isArray(sanitizedEvents)) {
      throw new TypeError('events must be an array');
    }

    if (sanitizedEvents.length === 0) {
      return { written: 0, bytes: 0, file: currentPath };
    }

    const operation = async () => {
      let written = 0;
      let bytes = 0;
      const serializedEvents = sanitizedEvents.map((event) => {
        const text = `${JSON.stringify(event)}\n`;
        const size = Buffer.byteLength(text, 'utf8');
        return { text, size };
      });

      for (const entry of serializedEvents) {
        if (entry.size > maxBytes) {
          const tooLargeError = new Error(
            `Serialized perf event exceeds maxBytes policy (${entry.size} > ${maxBytes})`,
          );
          tooLargeError.code = 'E_PERF_EVENT_TOO_LARGE';
          throw tooLargeError;
        }
      }

      for (const entry of serializedEvents) {
        const { text, size } = entry;

        if (currentPath && !fs.existsSync(currentPath)) {
          currentSize = 0;
        }

        if (currentSize + size > maxBytes && currentSize > 0) {
          rotateIfNeeded();
        }

        await fs.promises.appendFile(currentPath, text, 'utf8');
        written += 1;
        bytes += size;
        currentSize += size;

        trimRetention();

        if (!fs.existsSync(currentPath)) {
          currentSize = 0;
        }
      }

      return { written, bytes, file: currentPath };
    };

    const next = inFlight.then(operation, operation);
    inFlight = next.catch(() => {});
    return next;
  }

  function readSegmentPaths() {
    return discoverSegments(dir, baseName).map((segment) => segment.path);
  }

  return {
    appendBatch,
    readSegmentPaths,
    config,
    isAvailable: true,
    sanitizePerfEventBatch,
    sanitizePerfSummary,
  };
}

module.exports = {
  createPerfLogWriter,
  PERF_LOG_WRITER_DEFAULTS,
  sanitizePerfEvent,
  sanitizePerfEventBatch,
  sanitizePerfSummary,
};
