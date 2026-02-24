const { getGatewayConfig } = require('./helpers');

async function requestSessionsUsage(args = {}) {
  const gw = getGatewayConfig();
  if (!gw.token) throw new Error('Gateway token not configured');

  const gwRes = await fetch(`http://127.0.0.1:${gw.port}/tools/invoke`, {
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

  if (!gwRes.ok) {
    const errBody = await gwRes.text();
    let detail = errBody;
    try { detail = JSON.parse(errBody).error?.message || errBody; } catch {}
    throw new Error(`Gateway error: ${detail}`);
  }

  return gwRes.json();
}

module.exports = { requestSessionsUsage };
