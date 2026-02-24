const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
  stripSecrets,
  getSessionStatus,
  getGatewayConfig,
  loadDeviceIdentity
};
