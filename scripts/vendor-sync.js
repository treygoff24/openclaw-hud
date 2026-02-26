#!/usr/bin/env node
/**
 * Vendor Sync Script
 *
 * Downloads CDN dependencies to local vendor folder for offline/fallback support.
 * Run: npm run vendor:sync
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

const VENDOR_DIR = path.join(__dirname, "..", "public", "vendor");

const VENDORS = [
  {
    name: "marked",
    version: "15.0.7",
    url: "https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js",
    filename: "marked.min.js",
    integrity: "sha384-H+hy9ULve6xfxRkWIh/YOtvDdpXgV2fmAGQkIDTxIgZwNoaoBal14Di2YTMR6MzR",
  },
  {
    name: "dompurify",
    version: "3.2.4",
    url: "https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js",
    filename: "purify.min.js",
    integrity: "sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu",
  },
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, { timeout: 30000 }, (response) => {
        if (response.statusCode !== 200) {
          file.close(() => fs.unlink(dest, () => {}));
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        file.close(() => {});
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

function parseIntegrity(expectedIntegrity) {
  const normalized = String(expectedIntegrity || "").trim();
  const parts = normalized.split("-", 2);
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid integrity format: ${expectedIntegrity}`);
  }
  return { algorithm: parts[0], digest: parts[1] };
}

function computeSriIntegrity(filepath, algorithm = "sha384") {
  const fileBuffer = fs.readFileSync(filepath);
  const digest = crypto.createHash(algorithm).update(fileBuffer).digest("base64");
  return `${algorithm}-${digest}`;
}

function verifyFile(filepath, expectedIntegrity) {
  const { algorithm } = parseIntegrity(expectedIntegrity);
  const actualIntegrity = computeSriIntegrity(filepath, algorithm);
  const expectedBuffer = Buffer.from(String(expectedIntegrity), "utf8");
  const actualBuffer = Buffer.from(actualIntegrity, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function main() {
  console.log("🔧 Vendor Sync: Downloading CDN dependencies...\n");

  // Ensure vendor directory exists
  if (!fs.existsSync(VENDOR_DIR)) {
    fs.mkdirSync(VENDOR_DIR, { recursive: true });
    console.log(`Created: ${VENDOR_DIR}`);
  }

  let success = 0;
  let failed = 0;

  for (const vendor of VENDORS) {
    const destPath = path.join(VENDOR_DIR, vendor.filename);

    try {
      process.stdout.write(`Downloading ${vendor.name}@${vendor.version}... `);

      await downloadFile(vendor.url, destPath);

      const verified = verifyFile(destPath, vendor.integrity);
      if (!verified) {
        fs.unlinkSync(destPath);
        throw new Error(`Integrity verification failed for ${vendor.name}@${vendor.version}`);
      }

      const size = fs.statSync(destPath).size;
      console.log(`✓ (${(size / 1024).toFixed(1)} KB)`);
      success++;
    } catch (err) {
      console.log(`✗ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${success} succeeded, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log("\n✅ Vendor sync complete. Files ready for CDN fallback.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
} else {
  module.exports = {
    VENDORS,
    downloadFile,
    parseIntegrity,
    computeSriIntegrity,
    verifyFile,
  };
}
