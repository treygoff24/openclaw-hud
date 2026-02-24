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
function resolveModelAlias(rawModel) {
  const model = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!model) return 'unknown';
  const aliases = module.exports.getModelAliasMap();
  const aliasConfig = aliases?.[model];
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
  const modelLabel = modelId ? resolveModelAlias(modelId) : 'unknown';

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
  loadDeviceIdentity
};
