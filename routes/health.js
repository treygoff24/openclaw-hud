const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();

// Store server start time for uptime calculation
const startTime = Date.now();
let healthStateProvider = null;

function setHealthStateProvider(provider) {
  healthStateProvider = typeof provider === "function" ? provider : null;
}

function readWebsocketCheck() {
  if (typeof healthStateProvider !== "function") {
    return { state: "unknown", websocketClients: null };
  }
  try {
    const snapshot = healthStateProvider() || {};
    const websocketClients = Number.isFinite(snapshot.websocketClients)
      ? Math.max(0, Math.floor(snapshot.websocketClients))
      : null;
    const gatewayConnected = snapshot.gatewayConnected === true;
    return {
      state: gatewayConnected ? "connected" : "disconnected",
      websocketClients,
    };
  } catch {
    return { state: "unknown", websocketClients: null };
  }
}

function isFilesystemWritable(checkDir) {
  try {
    fs.statSync(checkDir);
    fs.accessSync(checkDir, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// GET /health - Health check endpoint with dependency checks
router.get("/health", (req, res) => {
  const websocketCheck = readWebsocketCheck();
  const checks = {
    websocket: websocketCheck.state,
    filesystem: "writable",
  };
  if (websocketCheck.websocketClients !== null)
    checks.websocketClients = websocketCheck.websocketClients;

  // Check filesystem writability without creating probe files
  const testDir = process.env.OPENCLAW_HOME || path.join(require("os").homedir(), ".openclaw");
  if (!isFilesystemWritable(testDir)) {
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
  const hasFsFailure = checks.filesystem !== "writable";
  const hasWsFailure = checks.websocket === "disconnected";

  const health = {
    status: hasFsFailure || hasWsFailure ? "degraded" : "healthy",
    version,
    uptime,
    checks,
  };

  const statusCode = health.status === "healthy" ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
module.exports.setHealthStateProvider = setHealthStateProvider;
