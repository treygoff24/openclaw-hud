import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Color contrast calculation utilities
 * Using relative luminance formula from WCAG 2.1
 */

function hexToRgb(hex) {
  // Remove # if present
  hex = hex.replace("#", "");

  // Handle 3-char hex
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return { r, g, b };
}

function getLuminance(r, g, b) {
  // Convert to sRGB
  const rsRGB = r / 255;
  const gsRGB = g / 255;
  const bsRGB = b / 255;

  // Apply gamma correction
  const rLinear = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
  const gLinear = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
  const bLinear = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

function getContrastRatio(color1, color2) {
  const rgb1 = typeof color1 === "string" ? hexToRgb(color1) : color1;
  const rgb2 = typeof color2 === "string" ? hexToRgb(color2) : color2;

  const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);

  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

describe("Color Contrast Compliance (WCAG 2.1 AA)", () => {
  let cssContent;

  beforeEach(() => {
    const cssPath = path.join(process.cwd(), "public/styles/base.css");
    if (fs.existsSync(cssPath)) {
      cssContent = fs.readFileSync(cssPath, "utf8");
    }
  });

  describe("CSS Variable Colors", () => {
    const colorPairs = [
      { fg: "#e0e6f0", bg: "#0a0a0f", name: "text-primary on bg-deep", required: 4.5 },
      { fg: "#7a80a0", bg: "#0a0a0f", name: "text-dim on bg-deep", required: 4.5 },
      { fg: "#a0a8c0", bg: "#0d0f18", name: "text-label on bg-panel", required: 4.5 },
      { fg: "#00e5ff", bg: "#0a0a0f", name: "cyan accent on bg-deep", required: 4.5 },
      { fg: "#ffab00", bg: "#0a0a0f", name: "amber on bg-deep", required: 4.5 },
      { fg: "#39ff14", bg: "#0a0a0f", name: "green on bg-deep", required: 4.5 },
      { fg: "#ff1744", bg: "#0a0a0f", name: "red error on bg-deep", required: 4.5 },
      { fg: "#ff2d7b", bg: "#0a0a0f", name: "magenta on bg-deep", required: 4.5 },
      { fg: "#e0e6f0", bg: "#111425", name: "text-primary on bg-card", required: 4.5 },
      { fg: "#7a80a0", bg: "#111425", name: "text-dim on bg-card", required: 4.5 },
    ];

    colorPairs.forEach(({ fg, bg, name, required }) => {
      it(`${name} should meet ${required}:1 contrast ratio`, () => {
        const ratio = getContrastRatio(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(required);
      });
    });
  });

  describe("Large Text Colors (3:1 ratio acceptable)", () => {
    const largeTextPairs = [
      { fg: "#a0a8c0", bg: "#0d0f18", name: "text-label (large) on bg-panel", required: 3 },
      { fg: "#00e5ff", bg: "#111425", name: "cyan (large) on bg-card", required: 3 },
    ];

    largeTextPairs.forEach(({ fg, bg, name, required }) => {
      it(`${name} should meet ${required}:1 contrast ratio`, () => {
        const ratio = getContrastRatio(fg, bg);
        expect(ratio).toBeGreaterThanOrEqual(required);
      });
    });
  });
});

describe("CSS Variables Documentation", () => {
  it("should have documented text colors as WCAG compliant", () => {
    const cssPath = path.join(process.cwd(), "public/styles/base.css");
    const cssContent = fs.readFileSync(cssPath, "utf8");

    // Check that text colors have contrast comments
    expect(cssContent).toMatch(/WCAG AA/);
    expect(cssContent).toMatch(/4\.5:1/);
    expect(cssContent).toMatch(/4\.6:1/);
  });
});
