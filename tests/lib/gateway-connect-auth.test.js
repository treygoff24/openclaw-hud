// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';

const {
  buildConnectParams,
  buildDeviceProof,
  normalizeScopes,
} = require('../../lib/gateway-connect-auth');

function createIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
  const deviceId = crypto.createHash('sha256').update(raw).digest('hex');
  return { deviceId, publicKeyPem, privateKeyPem };
}

describe('gateway-connect-auth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes scopes as unique non-empty strings', () => {
    const scopes = normalizeScopes(['operator.read', ' operator.read ', '', 'operator.write', null]);
    expect(scopes).toEqual(['operator.read', 'operator.write']);
  });

  it('builds connect params with signed device proof', () => {
    const params = buildConnectParams({
      token: 'abc123',
      nonce: 'nonce-1',
      role: 'operator',
      scopes: ['operator.read'],
      client: { id: 'client-1', mode: 'ui' },
      identity: createIdentity(),
    });

    expect(params.auth.token).toBe('abc123');
    expect(params.role).toBe('operator');
    expect(params.scopes).toEqual(['operator.read']);
    expect(params.device).toBeTruthy();
    expect(params.device.id).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof params.device.publicKey).toBe('string');
    expect(typeof params.device.signature).toBe('string');
    expect(params.device.nonce).toBe('nonce-1');
    expect(typeof params.device.signedAt).toBe('number');
  });

  it('requires nonce and token', () => {
    const identity = createIdentity();
    expect(() => buildDeviceProof({ token: '', nonce: 'n', identity })).toThrow(/token/i);
    expect(() => buildDeviceProof({ token: 't', nonce: '', identity })).toThrow(/nonce/i);
  });

  it('generates fresh signatures when signedAt changes', () => {
    const identity = createIdentity();
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000);
    const first = buildDeviceProof({ token: 't', nonce: 'same-nonce', identity });
    nowSpy.mockReturnValueOnce(2000);
    const second = buildDeviceProof({ token: 't', nonce: 'same-nonce', identity });

    expect(first.signedAt).toBe(1000);
    expect(second.signedAt).toBe(2000);
    expect(first.signature).not.toBe(second.signature);
  });
});
