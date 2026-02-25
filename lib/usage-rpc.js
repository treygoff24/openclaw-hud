const { getGatewayConfig } = require('./helpers');

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

async function requestSessionsUsage(args = {}) {
  const gw = getGatewayConfig();
  if (!gw.token) throw gatewayError('GATEWAY_TOKEN_MISSING', 'Gateway token not configured');

  const host = getGatewayHost(gw);
  if (!isLocalLoopbackHost(host)) {
    throw gatewayError('GATEWAY_HOST_UNSUPPORTED', 'Gateway host must be local/loopback for token-authenticated HTTP requests');
  }

  const url = `http://${formatHostForUrl(host)}:${gw.port}/tools/invoke`;

  let gwRes;
  try {
    gwRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gw.token}`,
      },
      body: JSON.stringify({
        tool: 'sessions.usage',
        args,
      }),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw gatewayError('GATEWAY_UNREACHABLE', `Gateway request failed: ${detail}`);
  }

  if (!gwRes.ok) {
    const errBody = await gwRes.text();
    let detail = errBody;
    try { detail = JSON.parse(errBody).error?.message || errBody; } catch {}
    const err = gatewayError('GATEWAY_RESPONSE_ERROR', `Gateway error: ${detail}`);
    err.status = gwRes.status;
    throw err;
  }

  return gwRes.json();
}

module.exports = { requestSessionsUsage };
