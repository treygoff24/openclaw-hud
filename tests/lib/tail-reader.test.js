import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TMPDIR = path.join(os.tmpdir(), "tail-reader-test-" + Date.now());
fs.mkdirSync(TMPDIR, { recursive: true });

afterAll(() => {
  fs.rmSync(TMPDIR, { recursive: true, force: true });
});

const { tailLines } = await import("../../lib/tail-reader.js");

describe("tailLines", () => {
  it("returns empty array for non-existent file", async () => {
    const result = await tailLines(path.join(TMPDIR, "nonexistent.jsonl"), 5);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    const fp = path.join(TMPDIR, "empty.jsonl");
    fs.writeFileSync(fp, "");
    const result = await tailLines(fp, 5);
    expect(result).toEqual([]);
  });

  it("returns single line from single-line file", async () => {
    const fp = path.join(TMPDIR, "single.jsonl");
    fs.writeFileSync(fp, '{"type":"msg","content":"hello"}');
    const result = await tailLines(fp, 5);
    expect(result).toEqual(['{"type":"msg","content":"hello"}']);
  });

  it("returns single line from file with trailing newline", async () => {
    const fp = path.join(TMPDIR, "trailing.jsonl");
    fs.writeFileSync(fp, '{"type":"msg","content":"hello"}\n');
    const result = await tailLines(fp, 5);
    expect(result).toEqual(['{"type":"msg","content":"hello"}']);
  });

  it("returns last N lines from multi-line file", async () => {
    const fp = path.join(TMPDIR, "multi.jsonl");
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(JSON.stringify({ idx: i }));
    }
    fs.writeFileSync(fp, lines.join("\n") + "\n");
    const result = await tailLines(fp, 5);
    expect(result).toHaveLength(5);
    expect(JSON.parse(result[0]).idx).toBe(15);
    expect(JSON.parse(result[4]).idx).toBe(19);
  });

  it("returns all lines when file has fewer than N lines", async () => {
    const fp = path.join(TMPDIR, "few.jsonl");
    const lines = [
      JSON.stringify({ a: 1 }),
      JSON.stringify({ a: 2 }),
      JSON.stringify({ a: 3 }),
    ];
    fs.writeFileSync(fp, lines.join("\n") + "\n");
    const result = await tailLines(fp, 10);
    expect(result).toHaveLength(3);
    expect(JSON.parse(result[0]).a).toBe(1);
    expect(JSON.parse(result[2]).a).toBe(3);
  });

  it("handles file smaller than buffer size", async () => {
    const fp = path.join(TMPDIR, "small.jsonl");
    fs.writeFileSync(fp, '{"x":1}\n{"x":2}\n');
    // Use a very large buffer
    const result = await tailLines(fp, 5, 65536);
    expect(result).toHaveLength(2);
  });

  it("handles file larger than buffer size", async () => {
    const fp = path.join(TMPDIR, "large.jsonl");
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push(JSON.stringify({ idx: i, padding: "x".repeat(100) }));
    }
    fs.writeFileSync(fp, lines.join("\n") + "\n");
    // Use a small buffer to force multiple reads
    const result = await tailLines(fp, 3, 256);
    expect(result).toHaveLength(3);
    expect(JSON.parse(result[0]).idx).toBe(97);
    expect(JSON.parse(result[2]).idx).toBe(99);
  });

  it("defaults to 5 lines when n is not specified", async () => {
    const fp = path.join(TMPDIR, "default-n.jsonl");
    const lines = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify({ idx: i }));
    }
    fs.writeFileSync(fp, lines.join("\n") + "\n");
    const result = await tailLines(fp);
    expect(result).toHaveLength(5);
    expect(JSON.parse(result[0]).idx).toBe(5);
  });

  it("skips empty lines between content lines", async () => {
    const fp = path.join(TMPDIR, "gaps.jsonl");
    fs.writeFileSync(fp, '{"a":1}\n\n{"a":2}\n\n{"a":3}\n');
    const result = await tailLines(fp, 5);
    expect(result).toHaveLength(3);
    expect(result.every((l) => l.length > 0)).toBe(true);
  });
});
