import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const helpers = require("../../lib/helpers");

helpers.OPENCLAW_HOME = "/mock/home";
helpers.safeReaddir = vi.fn(() => []);
helpers.safeRead = vi.fn(() => null);

function createApp() {
  delete require.cache[require.resolve("../../routes/model-usage")];
  const router = require("../../routes/model-usage");
  const app = express();
  app.use(router);
  return app;
}

describe("model-usage route seam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(require("fs"), "statSync").mockReturnValue({ mtimeMs: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves legacy /api/model-usage endpoint from dedicated route module", async () => {
    helpers.safeReaddir.mockImplementation((fp) => {
      if (fp === "/mock/home/agents") return ["agent-a"];
      if (fp === "/mock/home/agents/agent-a/sessions") return ["sess-1.jsonl"];
      return [];
    });

    helpers.safeRead.mockImplementation((fp) => {
      if (fp === "/mock/home/agents/agent-a/sessions/sess-1.jsonl") {
        return JSON.stringify({
          type: "message",
          message: {
            model: "openai/gpt-5",
            usage: {
              input: 10,
              output: 5,
              totalTokens: 15,
              cost: { total: 0.01 },
            },
          },
        });
      }
      return null;
    });

    const res = await request(createApp()).get("/api/model-usage");

    expect(res.status).toBe(200);
    expect(res.body["openai/gpt-5"].totalTokens).toBe(15);
    expect(res.body["openai/gpt-5"].agents["agent-a"].totalTokens).toBe(15);
  });

  it("server wires dedicated model-usage route module", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const serverPath = path.default.join(process.cwd(), "server.js");
    const content = fs.readFileSync(serverPath, "utf-8");

    expect(content).toMatch(/require\(["']\.\/routes\/model-usage["']\)/);
  });
});
