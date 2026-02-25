import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Reduced Motion Support", () => {
  it("should have prefers-reduced-motion media query in a11y.css", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("should disable panel animations for reduced motion", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.panel\s*\{[^}]*animation:\s*none/);
  });

  it("should disable modal animations for reduced motion", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.modal-content\s*\{[^}]*animation:\s*none/);
  });

  it("should disable pulsing dots for reduced motion", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.status-dot-green\s*,\s*\.status-dot-amber/);
    expect(cssContent).toMatch(/animation:\s*none/);
  });

  it("should disable streaming pulse for reduced motion", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.chat-msg\.streaming/);
  });

  it("should have transition duration set to 0.01ms for reduced motion", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/transition-duration:\s*0\.01ms/);
    expect(cssContent).toMatch(/animation-duration:\s*0\.01ms/);
  });
});

describe("High Contrast Mode Support", () => {
  it("should have prefers-contrast media query", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/@media \(prefers-contrast:\s*more\)/);
  });

  it("should increase border width for high contrast", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/border-width:\s*2px/);
  });

  it("should strengthen focus indicators for high contrast", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/outline-width:\s*3px/);
  });
});

describe("Screen Reader Support", () => {
  it("should have sr-only utility class", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.sr-only/);
    expect(cssContent).toMatch(/position:\s*absolute/);
    expect(cssContent).toMatch(/width:\s*1px/);
    expect(cssContent).toMatch(/height:\s*1px/);
    expect(cssContent).toMatch(/overflow:\s*hidden/);
  });

  it("should have sr-only-focusable for skip links", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.sr-only-focusable/);
    expect(cssContent).toMatch(/:focus/);
  });

  it("should have skip link styles", () => {
    const fs = require("fs");
    const cssContent = fs.readFileSync("./public/styles/a11y.css", "utf8");

    expect(cssContent).toMatch(/\.skip-link/);
    expect(cssContent).toMatch(/top:\s*-40px/);
    expect(cssContent).toMatch(/top:\s*0/);
  });
});
