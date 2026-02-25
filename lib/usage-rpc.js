const crypto = require('crypto');
const { randomUUID } = require('crypto');
const WebSocket = require('ws');
const { getGatewayConfig, loadDeviceIdentity } = require('./helpers');

const CONNECT_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 30000;
const CLIENT_ID = 'openclaw-ios';
const CLIENT_MODE = 'ui';
const CONNECT_ROLE = 'operator';
const CONNECT_SCOPES = ['operator.read'];

function gatewayError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function getGatewayHost(gw = {}) {
  const raw = typeof gw.host === 'string' && gw.host.trim()
    ? gw.host.trim()
    : (typeof gw.bind === 'string' && gw.bind.trim() ? gw.bind.trim() : '127.0.0.1');

  if (raw.toLowerCase() === 'loopback') return '127.0.0.1';
  return raw;
}

function isLocalLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  const unwrapped = normalized.replace(/^\[/, '').replace(/\]$/, '');

  if (unwrapped === 'localhost' || unwrapped === '0.0.0.0' || unwrapped === 'loopback') return true;
  if (unwrapped === '::1' || unwrapped === '0:0:0:0:0:0:0:1') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(unwrapped)) return true;

  return false;
}

function formatHostForUrl(host) {
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;
  return host;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function toUtcDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function getRawPublicKeyBase64Url(publicKeyPem) {
  const spkiDer = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return toBase64Url(spkiDer.subarray(-32));
}

function buildDeviceProof({ token, nonce }) {
  const identity = loadDeviceIdentity();
  const signedAt = Date.now();
  const scopesCSV = CONNECT_SCOPES.join(',');
  const payload = [
    'v2',
    identity.deviceId,
    CLIENT_ID,
    CLIENT_MODE,
    CONNECT_ROLE,
    scopesCSV,
    String(signedAt),
    token,
    nonce,
  ].join('|');
  const signature = toBase64Url(crypto.sign(null, Buffer.from(payload), identity.privateKeyPem));

  return {
    id: identity.deviceId,
    publicKey: getRawPublicKeyBase64Url(identity.publicKeyPem),
    signature,
    signedAt,
    nonce,
  };
}

function mapSessionsUsageParams(args = {}) {
  const params = {};
  const passthroughKeys = ['key', 'limit', 'includeContextWeight', 'startDate', 'endDate', 'mode', 'utcOffset'];
  for (const key of passthroughKeys) {
    if (hasOwn(args, key) && args[key] !== undefined) params[key] = args[key];
  }

  if (!hasOwn(params, 'startDate') && hasOwn(args, 'from')) {
    const startDate = toUtcDate(args.from);
    if (startDate) params.startDate = startDate;
  }
  if (!hasOwn(params, 'endDate') && hasOwn(args, 'to')) {
    const endDate = toUtcDate(args.to);
    if (endDate) params.endDate = endDate;
  }
  if (!hasOwn(params, 'mode')) params.mode = 'utc';

  return params;
}

function isSessionsUsageUnavailable(rawError, method, message) {
  if (method !== 'sessions.usage') return false;

  const msg = String(message || '');
  const hasMethodName = /sessions\.usage/i.test(msg);
  const unavailableByMessage = /(tool not available|method not found|unknown method|not implemented|unsupported)/i.test(msg);
  const unavailableByCode = ['TOOL_NOT_AVAILABLE', 'METHOD_NOT_FOUND', 'UNKNOWN_METHOD', 'NOT_IMPLEMENTED']
    .includes(String(rawError?.code || '').toUpperCase());

  return (hasMethodName && unavailableByMessage) || unavailableByCode;
}

function createGatewayResponseError(rawError, method) {
  const message = rawError?.message || 'Unknown gateway error';
  const code = isSessionsUsageUnavailable(rawError, method, message)
    ? 'GATEWAY_SESSIONS_USAGE_UNAVAILABLE'
    : 'GATEWAY_RESPONSE_ERROR';
  const err = gatewayError(code, `Gateway error: ${message}`);
  const status = Number(rawError?.status ?? rawError?.statusCode);
  if (Number.isFinite(status) && status > 0) err.status = status;
  if (rawError?.code) err.gatewayCode = rawError.code;
  if (rawError?.requestId) err.requestId = rawError.requestId;
  if (method) err.gatewayMethod = method;
  return err;
}

function callGatewayWs({ url, token, method, params }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    let connectReqId = null;
    let methodReqId = null;

    const connectTimer = setTimeout(() => {
      failUnreachable('Gateway connect timed out');
    }, CONNECT_TIMEOUT_MS);
    let requestTimer = null;

    function cleanup() {
      clearTimeout(connectTimer);
      if (requestTimer) clearTimeout(requestTimer);
      ws.removeAllListeners();
    }

    function finish(err, value) {
      if (settled) return;
      settled = true;
      cleanup();
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(value);
    }

    function failUnreachable(detail) {
      finish(gatewayError('GATEWAY_UNREACHABLE', `Gateway request failed: ${detail}`));
    }

    ws.on('error', (err) => {
      const detail = err instanceof Error ? err.message : String(err);
      failUnreachable(detail);
    });

    ws.on('close', () => {
      if (settled) return;
      failUnreachable('connection closed');
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg?.event === 'connect.challenge' && !connectReqId) {
        try {
          connectReqId = randomUUID();
          const nonce = msg?.payload?.nonce;
          if (typeof nonce !== 'string' || !nonce.trim()) {
            failUnreachable('Gateway connect challenge missing nonce');
            return;
          }
          const device = buildDeviceProof({ token, nonce: nonce.trim() });
          ws.send(JSON.stringify({
            type: 'req',
            id: connectReqId,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: CLIENT_ID,
                displayName: 'openclaw hud usage',
                version: '1.0.0',
                platform: 'macos',
                mode: CLIENT_MODE,
                instanceId: 'openclaw-hud-usage',
              },
              locale: 'en-US',
              userAgent: 'openclaw-hud/1.0.0',
              role: CONNECT_ROLE,
              scopes: CONNECT_SCOPES,
              auth: { token },
              device,
            },
          }));
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          failUnreachable(detail);
        }
        return;
      }

      if (msg?.id && connectReqId && msg.id === connectReqId) {
        if (!msg.ok) {
          finish(createGatewayResponseError(msg.error, 'connect'));
          return;
        }

        clearTimeout(connectTimer);
        try {
          methodReqId = randomUUID();
          requestTimer = setTimeout(() => failUnreachable('request timed out'), REQUEST_TIMEOUT_MS);
          ws.send(JSON.stringify({
            type: 'req',
            id: methodReqId,
            method,
            params,
          }));
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          failUnreachable(detail);
        }
        return;
      }

      if (msg?.id && methodReqId && msg.id === methodReqId) {
        if (!msg.ok) {
          finish(createGatewayResponseError(msg.error, method));
          return;
        }
        finish(null, msg.payload);
      }
    });
  });
}

async function requestSessionsUsage(args = {}) {
  const gw = getGatewayConfig();
  if (!gw.token) throw gatewayError('GATEWAY_TOKEN_MISSING', 'Gateway token not configured');

  const host = getGatewayHost(gw);
  if (!isLocalLoopbackHost(host)) {
    throw gatewayError('GATEWAY_HOST_UNSUPPORTED', 'Gateway host must be local/loopback for token-authenticated HTTP requests');
  }

  const url = `ws://${formatHostForUrl(host)}:${gw.port}`;
  const params = mapSessionsUsageParams(args);

  const result = await callGatewayWs({
    url,
    token: gw.token,
    method: 'sessions.usage',
    params,
  });
  return { ok: true, result };
}

module.exports = { requestSessionsUsage };
