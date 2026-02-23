const fs = require('fs');
const path = require('path');
const JSON5 = require('json5');
const os = require('os');

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

module.exports = {
  OPENCLAW_HOME,
  safeRead,
  safeJSON,
  safeJSON5,
  safeReaddir,
  stripSecrets,
  getSessionStatus,
  getGatewayConfig
};
