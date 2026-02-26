import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import net from "net";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import WebSocket from "ws";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (!address || typeof address === "string") {
        srv.close(() => reject(new Error("Unable to reserve ephemeral port")));
        return;
      }
      const { port } = address;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

async function waitForServerReady(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok || res.status === 503) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

describe.sequential("server bootstrap integration", () => {
  let port;
  let openclawHome;
  let serverProcess;
  let serverLogs = "";

  beforeAll(async () => {
    port = await getFreePort();
    openclawHome = mkdtempSync(path.join(os.tmpdir(), "hud-server-bootstrap-"));
    writeFileSync(
      path.join(openclawHome, "openclaw.json"),
      JSON.stringify({
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-sonnet-4" },
          },
        },
      }),
      "utf8",
    );
    const serverPath = path.join(process.cwd(), "server.js");

    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        PORT: String(port),
        OPENCLAW_HOME: openclawHome,
        HUD_WS_AUTH_TOKEN: "integration-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout.on("data", (chunk) => {
      serverLogs += chunk.toString();
    });
    serverProcess.stderr.on("data", (chunk) => {
      serverLogs += chunk.toString();
    });

    await waitForServerReady(port);
  }, 30000);

  afterAll(async () => {
    if (serverProcess && !serverProcess.killed) {
      await new Promise((resolve) => {
        serverProcess.once("exit", () => resolve());
        serverProcess.kill("SIGTERM");
      });
    }
    if (openclawHome) {
      rmSync(openclawHome, { recursive: true, force: true });
    }
  }, 20000);

  it("wires health, config, and model-usage routes from bootstrap", async () => {
    const [healthRes, configRes, usageRes] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/health`),
      fetch(`http://127.0.0.1:${port}/api/config`),
      fetch(`http://127.0.0.1:${port}/api/model-usage`),
    ]);

    expect(healthRes.status).toBe(503);
    expect(configRes.status).toBe(200);
    expect(usageRes.status).toBe(200);

    const health = await healthRes.json();
    const config = await configRes.json();
    const usage = await usageRes.json();

    expect(health).toHaveProperty("status", "degraded");
    expect(health).toHaveProperty("checks.websocket", "disconnected");
    expect(config).toHaveProperty("defaultModel");
    expect(typeof usage).toBe("object");
  });

  it("rejects non-loopback websocket origins unless auth header token is present", async () => {
    const url = `ws://127.0.0.1:${port}`;

    const unauthorizedResult = await new Promise((resolve) => {
      const ws = new WebSocket(url, {
        origin: "https://example.com",
      });
      ws.once("open", () => resolve({ ok: true }));
      ws.once("error", (error) => resolve({ ok: false, message: String(error?.message || error) }));
    });

    expect(unauthorizedResult.ok).toBe(false);
    expect(unauthorizedResult.message).toContain("Unexpected server response: 403");

    const authorizedResult = await new Promise((resolve) => {
      const ws = new WebSocket(url, {
        origin: "https://example.com",
        headers: { "x-hud-ws-auth": "integration-secret" },
      });
      ws.once("open", () => {
        ws.close();
        resolve({ ok: true });
      });
      ws.once("error", (error) => resolve({ ok: false, message: String(error?.message || error) }));
    });

    expect(authorizedResult).toEqual({ ok: true });
  });

  it("does not crash at boot", () => {
    expect(serverProcess.exitCode).toBe(null);
    expect(serverLogs).not.toContain("Error: listen EADDRINUSE");
  });
});
