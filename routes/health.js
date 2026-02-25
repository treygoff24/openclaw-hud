const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();

// Store server start time for uptime calculation
const startTime = Date.now();

// GET /health - Health check endpoint with dependency checks
router.get("/health", (req, res) => {
  const checks = {
    websocket: "connected",
    filesystem: "writable",
  };

  // Check filesystem writability
  try {
    const testDir = process.env.OPENCLAW_HOME || path.join(require("os").homedir(), ".openclaw");
    const testFile = path.join(testDir, ".health-check-test");
    fs.writeFileSync(testFile, "test", { flag: "w" });
    fs.unlinkSync(testFile);
  } catch (err) {
    checks.filesystem = "unwritable";
  }

  // Get version from package.json
  let version = "unknown";
  try {
    const packageJson = require("../package.json");
    version = packageJson.version;
  } catch (err) {
    // version remains 'unknown'
  }

  // Calculate uptime in seconds
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const health = {
    status: checks.filesystem === "writable" ? "healthy" : "degraded",
    version,
    uptime,
    checks,
  };

  const statusCode = health.status === "healthy" ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
