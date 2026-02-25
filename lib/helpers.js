const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const JSON5 = require('json5');

const AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/;
const LEGACY_SESSION_KEY_RE = /^[a-zA-Z0-9:_-]+$/;
const CANONICAL_SESSION_KEY_RE = /^agent:[a-zA-Z0-9_-]+:[a-zA-Z0-9:_-]+$/;

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), '.openclaw');

function safeRead(fp) {
  try { return fs.readFileSync(fp, 'utf-8'); } catch { return null; }
}

function safeJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}

function safeJSON5(fp) {
  try { return JSON5.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}

function safeReaddir(dp) {
  try { return fs.readdirSync(dp); } catch { return []; }
}

function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripSecrets);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/apiKey|token|password|secret|authorization|credential|private_key|signing_key/i.test(k)) continue;
    clean[k] = stripSecrets(v);
  }
  return clean;
}

function getSessionStatus(session) {
  const age = Date.now() - (session.updatedAt || 0);
  const isSubagent = (session.spawnDepth || 0) > 0;
  const FIVE_MIN = 5 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;
  if (age < FIVE_MIN) return 'active';
  if (isSubagent && age >= FIVE_MIN) return 'completed';
  if (age < ONE_HOUR) return 'warm';
  return 'stale';
}

function canonicalizeSessionKey(agentId, storedKey) {
  if (!AGENT_ID_RE.test(agentId)) {
    throw new Error(`Invalid agentId "${agentId}" for session key canonicalization`);
  }
  if (typeof storedKey !== 'string' || !storedKey.trim()) {
    throw new Error('Session key must be a non-empty string');
  }
  if (CANONICAL_SESSION_KEY_RE.test(storedKey)) {
    const [, keyAgentId] = storedKey.split(':');
    if (keyAgentId !== agentId) {
      throw new Error(`Canonical session key "${storedKey}" does not match agent "${agentId}"`);
    }
    return storedKey;
  }
  if (!LEGACY_SESSION_KEY_RE.test(storedKey)) {
    throw new Error(`Invalid legacy session key "${storedKey}"`);
  }
  return `agent:${agentId}:${storedKey}`;
}

function canonicalizeRelationshipKey(agentId, spawnedBy) {
  if (typeof spawnedBy !== 'string' || !spawnedBy.trim()) {
    return null;
  }
  if (CANONICAL_SESSION_KEY_RE.test(spawnedBy)) {
    return spawnedBy;
  }
  try {
    return canonicalizeSessionKey(agentId, spawnedBy);
  } catch {
    return null;
  }
}

function parseSessionAlias(storedKey) {
  if (typeof storedKey !== 'string' || !storedKey.trim()) return '';
  if (storedKey.startsWith('agent:')) {
    const parts = storedKey.split(':');
    return parts[parts.length - 1] || '';
  }
  const parts = storedKey.split(':');
  return parts[parts.length - 1] || storedKey;
}

function parseSessionModelLabel(session) {
  if (!session || typeof session !== 'object') return null;
  const rawModel =
    (typeof session.modelLabel === 'string' && session.modelLabel) ||
    (typeof session.model === 'string' && session.model) ||
    (typeof session.modelId === 'string' && session.modelId) ||
    (typeof session.lastModel === 'string' && session.lastModel) ||
    (typeof session.currentModel === 'string' && session.currentModel);
  return rawModel && rawModel.trim() ? rawModel.trim() : null;
}

function getModelAliasMap() {
  const primary = safeJSON(path.join(OPENCLAW_HOME, 'openclaw.json'));
  const fallback = safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const config = primary || fallback || {};
  const defaults = config.agents?.defaults || {};
  return defaults.models || {};
}

// Called via module.exports to enable test mocking of getModelAliasMap
function resolveModelAlias(rawModel, aliases) {
  const model = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!model) return 'unknown';
  const effectiveAliases = (aliases && typeof aliases === 'object')
    ? aliases
    : module.exports.getModelAliasMap();
  const aliasConfig = effectiveAliases?.[model];
  if (typeof aliasConfig === 'string' && aliasConfig.trim()) return aliasConfig.trim();
  if (aliasConfig && typeof aliasConfig === 'object' && typeof aliasConfig.alias === 'string' && aliasConfig.alias.trim()) {
    return aliasConfig.alias.trim();
  }
  const fallback = model.split('/').pop();
  return fallback || model;
}

function enrichSessionMetadata(storedKey, session, options = {}) {
  const sessionKey = options.sessionKey || session?.sessionKey || storedKey || '';
  const hasSpawnedBy = typeof session?.spawnedBy === 'string' && session.spawnedBy.trim().length > 0;
  const isSubagent = hasSpawnedBy || ((session?.spawnDepth || 0) > 0);
  const role = isSubagent ? 'subagent' : 'main';
  const explicitAlias = typeof session?.label === 'string' && session.label.trim() ? session.label.trim() : '';
  const sessionAlias = explicitAlias || parseSessionAlias(storedKey) || sessionKey;
  const modelId = parseSessionModelLabel(session);
  const modelLabel = modelId ? resolveModelAlias(modelId, options.modelAliases) : 'unknown';

  return {
    sessionRole: role,
    sessionAlias: sessionAlias,
    modelLabel: modelLabel,
    fullSlug: session?.fullSlug || sessionKey
  };
}

function getGatewayConfig() {
  const primary = safeJSON(path.join(OPENCLAW_HOME, 'openclaw.json'));
  const legacy = primary ? null : safeJSON5(path.join(OPENCLAW_HOME, 'config', 'source-of-truth.json5'));
  const config = primary || legacy || {};
  const gw = config.gateway || {};
  const auth = gw.auth || {};
  return {
    port: gw.port || 18789,
    token: auth.token || null
  };
}

function loadDeviceIdentity() {
  const candidates = [
    path.join(OPENCLAW_HOME, 'state', 'identity', 'device.json'),
    path.join(OPENCLAW_HOME, 'hud-device.json'),
  ];
  for (const fp of candidates) {
    const data = safeJSON(fp);
    if (data && data.deviceId && data.publicKeyPem && data.privateKeyPem) return data;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  const deviceId = crypto.createHash('sha256').update(raw).digest('hex');
  const identity = { deviceId, publicKeyPem, privateKeyPem };
  const savePath = candidates[1];
  try {
    fs.writeFileSync(savePath, JSON.stringify(identity, null, 2), { mode: 0o600 });
  } catch {}
  return identity;
}

function getLiveWeekWindow(tz = 'America/Chicago', nowMs = Date.now()) {
  const timeZone = typeof tz === 'string' && tz.trim().length > 0 ? tz : 'America/Chicago';
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false
  });

  const nowParts = getTimezoneParts(formatter, now);
  const weekdayToOffset = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const sundayOffset = weekdayToOffset[nowParts.weekday] || 0;

  const sunday = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day));
  sunday.setUTCDate(sunday.getUTCDate() - sundayOffset);

  const startWall = {
    year: sunday.getUTCFullYear(),
    month: sunday.getUTCMonth() + 1,
    day: sunday.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  };

  const startMs = timezoneWallToUtcMs(formatter, timeZone, startWall);

  return { fromMs: startMs, toMs: now };
}

function timezoneWallToUtcMs(formatter, timeZone, wallTarget) {
  const msGuess = Date.UTC(
    wallTarget.year,
    wallTarget.month - 1,
    wallTarget.day,
    wallTarget.hour,
    wallTarget.minute,
    wallTarget.second,
    wallTarget.millisecond
  );

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const probeOffsets = new Set();
  for (let delta = -48; delta <= 48; delta += 6) {
    const offset = getTimezoneOffsetMinutes(offsetFormatter, msGuess + (delta * 60 * 60 * 1000));
    if (Number.isFinite(offset)) probeOffsets.add(offset);
  }

  const exactMatches = [];
  for (const offsetMinutes of probeOffsets) {
    const candidateMs = msGuess - (offsetMinutes * 60 * 1000);
    const candidateParts = getTimezoneParts(formatter, candidateMs);
    if (compareWallTime(candidateParts, wallTarget) === 0) {
      exactMatches.push(candidateMs);
    }
  }

  if (exactMatches.length > 0) {
    return Math.min(...exactMatches);
  }

  // Fallback for non-existent wall times (e.g. spring-forward gaps):
  // binary search in minute space instead of millisecond space.
  const MINUTE_MS = 60 * 1000;
  let lo = Math.floor((msGuess - (36 * 60 * 60 * 1000)) / MINUTE_MS);
  let hi = Math.ceil((msGuess + (36 * 60 * 60 * 1000)) / MINUTE_MS);

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midMs = mid * MINUTE_MS;
    const midParts = getTimezoneParts(formatter, midMs);
    const cmp = compareWallTime(midParts, wallTarget);

    if (cmp === 0) {
      return midMs;
    }

    if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return hi * MINUTE_MS;
}

function getTimezoneOffsetMinutes(offsetFormatter, ms) {
  const tzPart = offsetFormatter
    .formatToParts(new Date(ms))
    .find((part) => part.type === 'timeZoneName')?.value;

  if (!tzPart || tzPart === 'GMT' || tzPart === 'UTC') return 0;

  const match = tzPart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return Number.NaN;

  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || '0');
  return sign * ((hours * 60) + minutes);
}

function getTimezoneParts(formatter, ms) {
  const map = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    millisecond: Number(map.fractionalSecond || '0')
  };
}

function compareWallTime(left, right) {
  const keys = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'];
  for (const key of keys) {
    if (left[key] < right[key]) return -1;
    if (left[key] > right[key]) return 1;
  }
  return 0;
}

module.exports = {
  OPENCLAW_HOME,
  safeRead,
  safeJSON,
  safeJSON5,
  safeReaddir,
  canonicalizeSessionKey,
  canonicalizeRelationshipKey,
  getModelAliasMap,
  enrichSessionMetadata,
  stripSecrets,
  getSessionStatus,
  getGatewayConfig,
  getLiveWeekWindow,
  timezoneWallToUtcMs,
  getTimezoneParts,
  loadDeviceIdentity
};
