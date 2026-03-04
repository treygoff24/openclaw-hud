import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import postcss from "postcss";
function readCssFile(path) {
  return fs.readFileSync(path, "utf8");
}

describe("Reduced Motion Support", () => {
  it("should parse a11y.css without syntax errors", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");
    expect(() => postcss.parse(cssContent)).not.toThrow();
  });

  it("should parse panels.css keyframes without syntax errors", () => {
    const panelsCss = readCssFile("./public/styles/panels.css");
    expect(() => postcss.parse(panelsCss)).not.toThrow();
  });

  it("should have valid status and alert keyframe definitions in panels.css", () => {
    const panelsCss = readCssFile("./public/styles/panels.css");
    const ast = postcss.parse(panelsCss);
    const keyframes = ast.nodes.filter((node) => node.type === "atrule" && node.name === "keyframes");

    const keyframeNames = keyframes.map((node) => node.params);
    expect(keyframeNames).toContain("blink-red");
    expect(keyframeNames).toContain("status-dot-live-pulse");
    expect(keyframeNames).toContain("status-dot-alert-pulse");

    const getKeyframe = (name) => keyframes.find((node) => node.params === name);
    const ensureKeyframeHasStops = (name, expectedStops) => {
      const keyframe = getKeyframe(name);
      expect(keyframe).toBeTruthy();
      const stops = keyframe.nodes.map((node) => node.selector.replace(/\s+/g, " ").trim());
      expect(stops).toEqual(expect.arrayContaining(expectedStops));
      expect(stops.length).toBeGreaterThanOrEqual(expectedStops.length);
    };

    ensureKeyframeHasStops("blink-red", ["0%, 100%", "50%"]);
    ensureKeyframeHasStops("status-dot-live-pulse", ["0%, 100%", "50%"]);
    ensureKeyframeHasStops("status-dot-alert-pulse", ["0%, 100%", "50%"]);
  });

  it("should have prefers-reduced-motion media query in a11y.css", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("should disable panel animations for reduced motion", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.panel\s*\{[^}]*animation:\s*none/);
  });

  it("should disable modal animations for reduced motion", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.modal-content\s*\{[^}]*animation:\s*none/);
  });

  it("should disable pulsing dots for reduced motion", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.status-dot-green\s*,\s*\.status-dot-amber/);
    expect(cssContent).toMatch(/animation:\s*none/);
    expect(cssContent).toMatch(/\.status-dot-green,\s*\.status-dot-amber,\s*\.status-dot-red/);
  });

  it("should disable all animated status dots for reduced motion", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(
      /\.status-dot-green,\s*\.status-dot-amber,\s*\.status-dot-red\s*\{\s*animation:\s*none\s*!important;\s*transform:\s*none\s*!important;/,
    );
  });

  it("should disable streaming pulse for reduced motion", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.chat-msg\.streaming/);
  });

  it("should have transition duration set to 0.01ms for reduced motion", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/transition-duration:\s*0\.01ms/);
    expect(cssContent).toMatch(/animation-duration:\s*0\.01ms/);
  });

  it("should use transform-free status pulse keyframes in panels.css", () => {
    const panelsCss = readCssFile("./public/styles/panels.css");
    const keyframeMatch = panelsCss.match(/@keyframes\s+status-dot-live-pulse\s*\{[\s\S]*?\}/m);

    expect(keyframeMatch).not.toBeNull();
    expect(keyframeMatch[0]).not.toMatch(/transform:/);
  });

  it("should use transform-free red alert pulse keyframes in panels.css", () => {
    const panelsCss = readCssFile("./public/styles/panels.css");
    const keyframeMatch = panelsCss.match(/@keyframes\s+status-dot-alert-pulse\s*\{[\s\S]*?\}/m);

    expect(keyframeMatch).not.toBeNull();
    expect(keyframeMatch[0]).not.toMatch(/transform:/);
  });
});

describe("High Contrast Mode Support", () => {
  it("should have prefers-contrast media query", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/@media \(prefers-contrast:\s*more\)/);
  });

  it("should increase border width for high contrast", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/border-width:\s*2px/);
  });

  it("should strengthen focus indicators for high contrast", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/outline-width:\s*3px/);
  });
});

describe("Screen Reader Support", () => {
  it("should have sr-only utility class", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.sr-only/);
    expect(cssContent).toMatch(/position:\s*absolute/);
    expect(cssContent).toMatch(/width:\s*1px/);
    expect(cssContent).toMatch(/height:\s*1px/);
    expect(cssContent).toMatch(/overflow:\s*hidden/);
  });

  it("should have sr-only-focusable for skip links", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.sr-only-focusable/);
    expect(cssContent).toMatch(/:focus/);
  });

  it("should have skip link styles", () => {
    const cssContent = readCssFile("./public/styles/a11y.css");

    expect(cssContent).toMatch(/\.skip-link/);
    expect(cssContent).toMatch(/top:\s*-40px/);
    expect(cssContent).toMatch(/top:\s*0/);
  });
});
