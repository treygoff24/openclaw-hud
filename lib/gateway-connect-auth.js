const crypto = require("crypto");
const { loadDeviceIdentity } = require("./helpers");

const DEFAULT_ROLE = "operator";
const DEFAULT_SCOPES = Object.freeze(["operator.read"]);
const DEFAULT_CLIENT = Object.freeze({
  id: "openclaw-ios",
  displayName: "openclaw hud",
  version: "1.0.0",
  platform: "macos",
  mode: "ui",
  instanceId: "openclaw-hud",
});

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function getRawPublicKeyBase64Url(publicKeyPem) {
  const spkiDer = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return toBase64Url(spkiDer.subarray(-32));
}

function normalizeScopes(scopes) {
  const source = Array.isArray(scopes) ? scopes : DEFAULT_SCOPES;
  const set = new Set();
  for (const scope of source) {
    if (typeof scope !== "string") continue;
    const trimmed = scope.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set];
}

function ensureToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Gateway token not configured");
  }
  return token.trim();
}

function ensureNonce(nonce) {
  if (typeof nonce !== "string" || !nonce.trim()) {
    throw new Error("Gateway connect challenge missing nonce");
  }
  return nonce.trim();
}

function ensureIdentity(identity) {
  if (!identity || typeof identity !== "object") {
    throw new Error("Device identity unavailable");
  }
  const { deviceId, publicKeyPem, privateKeyPem } = identity;
  if (!deviceId || !publicKeyPem || !privateKeyPem) {
    throw new Error("Device identity incomplete");
  }
  return { deviceId, publicKeyPem, privateKeyPem };
}

function buildDeviceProof({
  token,
  nonce,
  role = DEFAULT_ROLE,
  scopes = DEFAULT_SCOPES,
  client,
  identity,
}) {
  const resolvedToken = ensureToken(token);
  const resolvedNonce = ensureNonce(nonce);
  const resolvedIdentity = ensureIdentity(identity || loadDeviceIdentity());
  const resolvedClient = { ...DEFAULT_CLIENT, ...(client || {}) };
  const resolvedScopes = normalizeScopes(scopes);
  const signedAt = Date.now();

  const payload = [
    "v2",
    resolvedIdentity.deviceId,
    resolvedClient.id,
    resolvedClient.mode,
    role,
    resolvedScopes.join(","),
    String(signedAt),
    resolvedToken,
    resolvedNonce,
  ].join("|");

  const signature = toBase64Url(
    crypto.sign(null, Buffer.from(payload), resolvedIdentity.privateKeyPem),
  );

  return {
    id: resolvedIdentity.deviceId,
    publicKey: getRawPublicKeyBase64Url(resolvedIdentity.publicKeyPem),
    signature,
    signedAt,
    nonce: resolvedNonce,
  };
}

function buildConnectParams({
  token,
  nonce,
  role = DEFAULT_ROLE,
  scopes = DEFAULT_SCOPES,
  client,
  locale = "en-US",
  userAgent = "openclaw-hud/1.0.0",
  minProtocol = 3,
  maxProtocol = 3,
  identity,
}) {
  const resolvedToken = ensureToken(token);
  const resolvedClient = { ...DEFAULT_CLIENT, ...(client || {}) };
  const resolvedScopes = normalizeScopes(scopes);
  const device = buildDeviceProof({
    token: resolvedToken,
    nonce,
    role,
    scopes: resolvedScopes,
    client: resolvedClient,
    identity,
  });

  return {
    minProtocol,
    maxProtocol,
    client: resolvedClient,
    locale,
    userAgent,
    role,
    scopes: resolvedScopes,
    auth: { token: resolvedToken },
    device,
  };
}

module.exports = {
  DEFAULT_CLIENT,
  DEFAULT_ROLE,
  DEFAULT_SCOPES,
  buildConnectParams,
  buildDeviceProof,
  ensureNonce,
  ensureToken,
  normalizeScopes,
};
