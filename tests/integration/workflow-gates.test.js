import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("CI and release workflow gates", () => {
  it("PR E2E gate includes resilience and live-weekly specs", () => {
    const ciWorkflow = readRepoFile(".github/workflows/ci.yml");

    expect(ciWorkflow).toContain("e2e/resilience.spec.js");
    expect(ciWorkflow).toContain("e2e/models-live-weekly.spec.js");
  });

  it("manual release defaults to full E2E run", () => {
    const releaseWorkflow = readRepoFile(".github/workflows/release-manual.yml");

    expect(releaseWorkflow).toMatch(/full_e2e:[\s\S]*default:\s*"true"/);
  });

  it("manual release defaults to the master ref", () => {
    const releaseWorkflow = readRepoFile(".github/workflows/release-manual.yml");

    expect(releaseWorkflow).toMatch(/ref:[\s\S]*default:\s*master/);
  });
});
