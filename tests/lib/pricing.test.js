// @vitest-environment node
import { describe, it, expect } from "vitest";

const { buildPricingCatalog, repriceModelUsageRows } = require("../../lib/pricing");

describe("pricing repricer", () => {
  it("reprices token buckets from config rates", () => {
    const catalog = buildPricingCatalog({
      models: {
        providers: {
          openai: {
            models: [
              {
                id: "gpt-5",
                cost: { input: 10, output: 20, cacheRead: 5, cacheWrite: 1 },
              },
            ],
          },
        },
      },
    });

    const { rows, missingPricingModels } = repriceModelUsageRows(
      [
        {
          provider: "openai",
          model: "gpt-5",
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 200,
          cacheWriteTokens: 100,
          totalTokens: 1800,
          totalCost: 99.99,
        },
      ],
      { catalog },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].totalCost).toBeCloseTo(0.0211, 10);
    expect(missingPricingModels).toEqual([]);
  });

  it("keeps zero-priced models at zero without marking missing", () => {
    const catalog = buildPricingCatalog({
      models: {
        providers: {
          anthropic: {
            models: [
              {
                id: "claude-haiku-4",
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      },
    });

    const { rows, missingPricingModels } = repriceModelUsageRows(
      [
        {
          provider: "anthropic",
          model: "claude-haiku-4",
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 500,
          cacheWriteTokens: 250,
          totalTokens: 3750,
          totalCost: 7.77,
        },
      ],
      { catalog },
    );

    expect(rows[0].totalCost).toBe(0);
    expect(missingPricingModels).toEqual([]);
  });

  it("returns zero and diagnostics when pricing is missing", () => {
    const catalog = buildPricingCatalog({ models: { providers: { openai: { models: [] } } } });

    const { rows, missingPricingModels } = repriceModelUsageRows(
      [
        {
          provider: "openai",
          model: "gpt-unknown",
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 20,
          totalCost: 5,
        },
        {
          provider: "openai",
          model: "gpt-unknown",
          inputTokens: 5,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 10,
          totalCost: 6,
        },
      ],
      { catalog },
    );

    expect(rows.map((r) => r.totalCost)).toEqual([0, 0]);
    expect(missingPricingModels).toEqual(["openai/gpt-unknown"]);
  });
});
