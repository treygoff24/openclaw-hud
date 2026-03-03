import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");
const server = require("../../server");
const fs = require("fs");
const realpathSyncOriginal = fs.realpathSync;

helpers.getGatewayConfig = vi.fn(() => ({ port: 18789, token: "test-token" }));
fs.realpathSync = vi.fn((p) => p);

const mockFetch = vi.fn();
global.fetch = mockFetch;

const readySpawnPreflightState = {
  ok: true,
  enabled: true,
  code: "READY",
  status: "ready",
  reason: "spawn preflight passed",
  diagnostics: [],
  checkedAt: Date.now(),
  source: "route-test",
};

function createApp({ readyPreflight = true } = {}) {
  delete require.cache[require.resolve("../../routes/spawn")];
  const router = require("../../routes/spawn");
  if (readyPreflight && typeof router.setSpawnPreflightState === "function") {
    router.setSpawnPreflightState(readySpawnPreflightState);
  }
  const app = express();
  app.use(router);
  return app;
}

const validBody = { agentId: "bot", prompt: "Do something" };

function setPreflightState(state) {
  const spawnModule = require("../../routes/spawn");
  spawnModule.setSpawnPreflightState(state);
  return spawnModule;
}

describe("spawn preflight success detection", () => {
  it("does not expose probe helpers now that startup invocation is removed", () => {
    expect(typeof server.createSpawnPreflightProbePayload).toBe("undefined");
    expect(typeof server.isSpawnProbePayloadSuccess).toBe("undefined");
    expect(typeof server.isSpawnProbeSafeValidationRejection).toBe("undefined");
  });
});

describe("spawn preflight startup diagnostics", () => {
  let warnSpy;
  let spawnServer;
  let originalAllowlistOverride;
  let originalDenylistOverride;

  beforeEach(() => {
    vi.clearAllMocks();
    originalAllowlistOverride = process.env.OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE;
    originalDenylistOverride = process.env.OPENCLAW_SPAWN_DENYLIST_OVERRIDE;
    process.env.OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE = "true";
    process.env.OPENCLAW_SPAWN_DENYLIST_OVERRIDE = "true";
    helpers.getGatewayConfig = vi.fn(() => ({ port: 18789, token: "test-token" }));
    delete require.cache[require.resolve("../../server")];
    spawnServer = require("../../server");
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy?.mockRestore();
    if (originalAllowlistOverride === undefined) {
      delete process.env.OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE;
    } else {
      process.env.OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE = originalAllowlistOverride;
    }
    if (originalDenylistOverride === undefined) {
      delete process.env.OPENCLAW_SPAWN_DENYLIST_OVERRIDE;
    } else {
      process.env.OPENCLAW_SPAWN_DENYLIST_OVERRIDE = originalDenylistOverride;
    }
    delete require.cache[require.resolve("../../server")];
    mockFetch.mockReset();
  });

  it("returns READY from local-only startup preflight without network probe", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });

    const state = await spawnServer.runStartupProbe();

    expect(state.ok).toBe(true);
    expect(state.code).toBe("READY");
    expect(state.diagnostics).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("blocks startup preflight when gateway token is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    });
    spawnServer = require("../../server");
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: null });

    const state = await spawnServer.runStartupProbe();

    expect(state.ok).toBe(false);
    expect(state.code).toBe("SPAWN_TOKEN_MISSING");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks startup preflight when allowlist/denylist overrides are not true", async () => {
    process.env.OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE = "false";
    process.env.OPENCLAW_SPAWN_DENYLIST_OVERRIDE = "true";

    const state = await spawnServer.runStartupProbe();

    expect(state.ok).toBe(false);
    expect(state.code).toBe("SPAWN_HARDENING_PRECHECK");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not call fetch for startup probe when local config passes", async () => {
    const state = await spawnServer.runStartupProbe();

    expect(state.ok).toBe(true);
    expect(state.code).toBe("READY");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/spawn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: "test-token" });
    fs.realpathSync.mockImplementation((p) => p);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ result: { details: { childSessionKey: "key-123", runId: "run-456" } } }),
      json: async () => ({ result: { details: { childSessionKey: "key-123", runId: "run-456" } } }),
    });
  });

  afterEach(() => {
    fs.realpathSync.mockReset();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    fs.realpathSync = realpathSyncOriginal;
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await request(createApp()).post("/api/spawn").send({ agentId: "bot" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Prompt is required");
  });

  it("defaults to blocked state until startup preflight succeeds", async () => {
    const app = createApp({ readyPreflight: false });
    const preflightRes = await request(app).get("/api/spawn-preflight");
    expect(preflightRes.status).toBe(200);
    expect(preflightRes.body.ok).toBe(false);
    expect(preflightRes.body.enabled).toBe(false);
    expect(preflightRes.body.code).toBe("SPAWN_PRECHECK_PENDING");

    const spawnRes = await request(app).post("/api/spawn").send(validBody);
    expect(spawnRes.status).toBe(503);
    expect(spawnRes.body.enabled).toBe(false);
    expect(spawnRes.body.code).toBe("SPAWN_PRECHECK_PENDING");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when prompt is not a string", async () => {
    const res = await request(createApp()).post("/api/spawn").send({ agentId: "bot", prompt: 123 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Prompt must be a string");
  });

  it("returns 400 when prompt is empty string", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ agentId: "bot", prompt: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt exceeds 50000 chars", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ agentId: "bot", prompt: "x".repeat(50001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("too long");
  });

  it("returns 400 when agentId is missing", async () => {
    const res = await request(createApp()).post("/api/spawn").send({ prompt: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Agent is required");
  });

  it("returns preflight diagnostics and enabled flag", async () => {
    const app = createApp();
    setPreflightState({
      ok: false,
      enabled: false,
      code: "SPAWN_HARDENING_PRECHECK",
      status: "blocked",
      reason: "Missing allowlist/denylist override",
      diagnostics: [
        {
          code: "SPAWN_HARDENING_PRECHECK",
          message: "Set OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE and OPENCLAW_SPAWN_DENYLIST_OVERRIDE",
          remediation: "Configure both overrides to permit spawn invoke calls.",
        },
      ],
    });

    const res = await request(app).get("/api/spawn-preflight");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.enabled).toBe(false);
    expect(res.body.code).toBe("SPAWN_HARDENING_PRECHECK");
    expect(res.body.diagnostics).toHaveLength(1);
  });

  it("returns 503 for /api/spawn when preflight is blocked", async () => {
    const app = createApp();
    setPreflightState({
      ok: false,
      enabled: false,
      code: "SPAWN_HARDENING_PRECHECK",
      status: "blocked",
      reason: "Missing allowlist/denylist override",
      diagnostics: [
        {
          code: "SPAWN_HARDENING_PRECHECK",
          message: "Set OPENCLAW_SPAWN_ALLOWLIST_OVERRIDE and OPENCLAW_SPAWN_DENYLIST_OVERRIDE",
          remediation: "Configure both overrides to permit spawn invoke calls.",
        },
      ],
    });

    const res = await request(app).post("/api/spawn").send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.enabled).toBe(false);
    expect(res.body.code).toBe("SPAWN_HARDENING_PRECHECK");
    expect(res.body.diagnostics).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when contextFiles is not a string", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, contextFiles: ["/tmp/file1"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("ContextFiles must be a string");
  });

  it("rejects cross-site origin", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .set("Origin", "https://attacker.example")
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden origin");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows loopback origin", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .set("Origin", "http://localhost:3777")
      .send(validBody);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
  });

  it("passes session mode to gateway when requested", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, mode: "session" });
    expect(res.status).not.toBe(400);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.mode).toBe("session");
  });

  it("calls /tools/invoke with sessions_spawn and required args", async () => {
    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchUrl).toBe("http://127.0.0.1:18789/tools/invoke");
    const fetchBody = JSON.parse(fetchOptions.body);
    expect(fetchBody.tool).toBe("sessions_spawn");
    expect(fetchBody.args).toMatchObject({
      agentId: "bot",
      task: "Do something",
      mode: "run",
    });
  });

  it("returns 400 for invalid label format", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, label: "has spaces!" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid label");
  });

  it("returns 400 for label exceeding 64 chars", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, label: "a".repeat(65) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for timeout out of range", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, timeout: 9999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Timeout");
  });

  it("returns 500 when gateway token is not configured", async () => {
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: null });
    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(500);
    expect(res.body.error).toContain("token not configured");
  });

  it("normalizes gateway tool errors using compatibility error mapping", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: { code: "INVALID_REQUEST", message: "payload missing field" },
        }),
    });

    const res = await request(createApp()).post("/api/spawn").send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
    expect(res.body.reason).toBe("invalid_request");
    expect(res.body.error).toContain("payload missing field");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("preserves nested gateway error code and status fields", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: {
            code: "INVALID_REQUEST",
            status: 422,
            message: "agentId must be a string",
          },
        }),
    });

    const res = await request(createApp()).post("/api/spawn").send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
    expect(res.body.rawCode).toBe("INVALID_REQUEST");
    expect(res.body.rawStatus).toBe(422);
    expect(res.body.error).toContain("agentId must be a string");
  });

  it("returns normalized failure when spawn response omits session/run identifiers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ result: { details: { accepted: true } } }),
      json: async () => ({ result: { details: { accepted: true } } }),
    });

    const res = await request(createApp()).post("/api/spawn").send(validBody);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("GATEWAY_ERROR");
    expect(res.body.reason).toBe("gateway_error");
    expect(res.body.error).toContain("spawn response missing session/run identifiers");
  });

  it("fails closed when gateway host is not local loopback", async () => {
    helpers.getGatewayConfig.mockReturnValue({
      host: "198.51.100.44",
      port: 18789,
      token: "test-token",
    });
    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("GATEWAY_HOST_UNSUPPORTED");
    expect(res.body.error).toContain("loopback");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("successfully spawns and returns session key and run ID", async () => {
    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.sessionKey).toBe("key-123");
    expect(res.body.runId).toBe("run-456");
  });

  it("forwards model and label to gateway when provided", async () => {
    await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, model: "gpt-4", label: "my-task" });
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.model).toBe("gpt-4");
    expect(fetchBody.args.label).toBe("my-task");
    expect(fetchBody.args.mode).toBe("run");
  });

  it("returns 502 when gateway returns error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      text: async () => JSON.stringify({ error: { message: "agent not found" } }),
    });
    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("agent not found");
  });

  it("maps gateway transport errors to UNAVAILABLE", async () => {
    const transportErr = new Error("ECONNREFUSED");
    transportErr.code = "ECONNREFUSED";
    mockFetch.mockRejectedValue(transportErr);

    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("UNAVAILABLE");
    expect(res.body.reason).toBe("network_unreachable");
    expect(res.body.error).toContain("ECONNREFUSED");
  });

  it("returns 502 when gateway is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(createApp()).post("/api/spawn").send(validBody);
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("ECONNREFUSED");
    expect(res.body.code).toBe("UNAVAILABLE");
  });

  it("enforces rate limit of 5 spawns per minute", async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/spawn").send(validBody);
    }
    const res = await request(app).post("/api/spawn").send(validBody);
    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Rate limit");
  });

  it("validates context files are within allowed directories", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({
        ...validBody,
        contextFiles: "/etc/passwd\n/var/secret",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not in allowed directory");
  });

  it("rejects context file that resolves outside allowed roots via symlink", async () => {
    fs.realpathSync.mockImplementationOnce(() => "/etc/passwd");

    const res = await request(createApp())
      .post("/api/spawn")
      .send({
        ...validBody,
        contextFiles: "~/Development/symlinked-file.txt",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("escapes allowed directory via symlink");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects more than 20 context files", async () => {
    const files = Array.from({ length: 21 }, (_, i) => `~/Development/file${i}.txt`).join("\n");
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, contextFiles: files });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Max 20");
  });

  it("defaults to run mode when no mode specified", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody });
    expect(res.status).not.toBe(400);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.mode).toBe("run");
  });

  it("rejects invalid mode values and defaults to run", async () => {
    const res = await request(createApp())
      .post("/api/spawn")
      .send({ ...validBody, mode: "invalid" });
    expect(res.status).not.toBe(400);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.mode).toBe("run");
  });

  it("uses model alias as label fallback when no label provided", async () => {
    // Create app first (this reloads the module)
    const app = createApp();
    // Get the freshly loaded module
    const spawnModule = require("../../routes/spawn");

    // Populate cached models on the freshly loaded module
    spawnModule.setCachedModels([
      { alias: "Kimi K2.5", fullId: "fireworks/accounts/fireworks/models/kimi-k2p5" },
      { alias: "GPT-4", fullId: "openai/gpt-4" },
    ]);

    const res = await request(app)
      .post("/api/spawn")
      .send({
        ...validBody,
        model: "fireworks/accounts/fireworks/models/kimi-k2p5",
        label: undefined,
      });
    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Should use the sanitized alias (non-alphanumeric chars replaced with underscores)
    expect(fetchBody.args.label).toBe("Kimi_K2_5");
  });

  it("preserves user-provided label over model alias", async () => {
    await request(createApp())
      .post("/api/spawn")
      .send({
        ...validBody,
        model: "gpt-4",
        label: "my-custom-label",
      });
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.label).toBe("my-custom-label");
  });
});

describe("resolveAliasFromModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    helpers.getGatewayConfig.mockReturnValue({ port: 18789, token: "test-token" });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ result: { details: { childSessionKey: "key-123", runId: "run-456" } } }),
      json: async () => ({ result: { details: { childSessionKey: "key-123", runId: "run-456" } } }),
    });
  });

  it("resolves alias by model id from cached models", async () => {
    // Create a test model list
    const testModels = [
      { id: "gpt-4", alias: "GPT-4 Turbo", model: "openai/gpt-4-turbo" },
      { id: "claude-opus", alias: "Claude 3 Opus", model: "anthropic/claude-3-opus" },
    ];

    const app = createApp();
    const spawnModule = require("../../routes/spawn");
    spawnModule.setCachedModels(testModels);

    const res = await request(app).post("/api/spawn").send({
      agentId: "bot",
      prompt: "test",
      model: "gpt-4",
    });

    expect(res.status).toBe(200);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.args.label).toBe("GPT-4_Turbo");
  });
});
