import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const indexHtml = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8");

describe("index security loading", () => {
  it("loads markdown dependencies from local vendor assets first", () => {
    expect(indexHtml).toContain('"/vendor/marked.min.js"');
    expect(indexHtml).toContain('"/vendor/purify.min.js"');
  });

  it("uses SRI + CORS settings for CDN fallback", () => {
    expect(indexHtml).toContain(
      "sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR",
    );
    expect(indexHtml).toContain(
      "sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu",
    );
    expect(indexHtml).toContain('crossOrigin: "anonymous"');
    expect(indexHtml).toContain("script.crossOrigin = options.crossOrigin;");
  });
});
