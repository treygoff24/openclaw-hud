// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { computeSriIntegrity, verifyFile } = await import("../../scripts/vendor-sync.js");

describe("vendor-sync integrity verification", () => {
  it("computes SRI and verifies matching integrity", () => {
    const tmpFile = path.join(os.tmpdir(), `vendor-sync-ok-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, 'console.log("ok");\n', "utf8");

    const integrity = computeSriIntegrity(tmpFile, "sha384");
    expect(integrity.startsWith("sha384-")).toBe(true);
    expect(verifyFile(tmpFile, integrity)).toBe(true);

    fs.unlinkSync(tmpFile);
  });

  it("fails verification on integrity mismatch", () => {
    const tmpFile = path.join(os.tmpdir(), `vendor-sync-bad-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, 'console.log("tampered");\n', "utf8");

    expect(verifyFile(tmpFile, "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(
      false,
    );

    fs.unlinkSync(tmpFile);
  });
});
