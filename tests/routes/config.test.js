import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const helpers = require('../../lib/helpers');

helpers.OPENCLAW_HOME = '/mock/home';
helpers.safeJSON5 = vi.fn();
helpers.stripSecrets = vi.fn((x) => x);

function mockConfigSources({ primary = null, legacy = null }) {
  helpers.safeJSON5.mockImplementation((fp) => {
    if (fp.endsWith('openclaw.json')) return primary;
    if (fp.endsWith('source-of-truth.json5')) return legacy;
    return null;
  });
}

function createApp() {
  delete require.cache[require.resolve('../../routes/config')];
  delete require.cache[require.resolve('../../routes/spawn')];

  const spawnRouter = require('../../routes/spawn');
  spawnRouter.setCachedModels = vi.fn();

  const router = require('../../routes/config');
  const app = express();
  app.use(router);
  return { app, spawnRouter };
}

describe('GET /api/models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses primary openclaw.json models and does not inject phantom hardcoded models', async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-4.1': { alias: 'gpt41' }
            }
          }
        }
      },
      legacy: {
        agents: {
          defaults: {
            models: {
              'anthropic/claude-haiku-4': { alias: 'haiku' }
            }
          }
        }
      }
    });

    const { app } = createApp();
    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { alias: 'default', fullId: '' },
      { alias: 'gpt41', fullId: 'openai/gpt-4.1' }
    ]);
  });

  it('falls back to legacy source-of-truth models when primary config is missing', async () => {
    mockConfigSources({
      primary: null,
      legacy: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5': { alias: 'gpt5' }
            }
          }
        }
      }
    });

    const { app } = createApp();
    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { alias: 'default', fullId: '' },
      { alias: 'gpt5', fullId: 'openai/gpt-5' }
    ]);
  });

  it('keeps config source consistent across /api/config and /api/models', async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            model: { primary: 'openai/gpt-4.1' },
            models: {
              'openai/gpt-4.1': { alias: 'gpt41' }
            }
          }
        }
      },
      legacy: {
        agents: {
          defaults: {
            model: { primary: 'anthropic/claude-haiku-4' },
            models: {
              'anthropic/claude-haiku-4': { alias: 'haiku' }
            }
          }
        }
      }
    });

    const { app } = createApp();
    const configRes = await request(app).get('/api/config');
    const modelsRes = await request(app).get('/api/models');

    expect(configRes.status).toBe(200);
    expect(configRes.body.defaultModel).toBe('openai/gpt-4.1');
    expect(modelsRes.status).toBe(200);
    expect(modelsRes.body).toEqual([
      { alias: 'default', fullId: '' },
      { alias: 'gpt41', fullId: 'openai/gpt-4.1' }
    ]);
  });

  it('updates spawn cached models using the exact API payload (for model-picker compatibility)', async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              'openai/gpt-5.3-codex': { alias: 'vulcan' }
            }
          }
        }
      }
    });

    const { app, spawnRouter } = createApp();
    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(spawnRouter.setCachedModels).toHaveBeenCalledTimes(1);
    expect(spawnRouter.setCachedModels).toHaveBeenCalledWith(res.body);
  });

  it('derives alias from model id tail when alias is absent', async () => {
    mockConfigSources({
      primary: {
        agents: {
          defaults: {
            models: {
              'google/gemini-2.5-pro': {}
            }
          }
        }
      }
    });

    const { app } = createApp();
    const res = await request(app).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { alias: 'default', fullId: '' },
      { alias: 'gemini-2.5-pro', fullId: 'google/gemini-2.5-pro' }
    ]);
  });
});
