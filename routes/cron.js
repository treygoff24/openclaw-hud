const fs = require("fs");
const path = require("path");
const express = require("express");
const { Router } = require("express");
const { OPENCLAW_HOME, safeJSON, safeJSON5, stripSecrets } = require("../lib/helpers");

const router = Router();

router.get("/api/cron", (req, res) => {
  const jobs = safeJSON(path.join(OPENCLAW_HOME, "cron", "jobs.json"));
  const config = safeJSON5(path.join(OPENCLAW_HOME, "config", "source-of-truth.json5"));
  const defaultModel = config?.agents?.defaults?.model?.primary || "unknown";

  const enrichedJobs = (jobs?.jobs || []).map((j) => ({
    ...j,
    defaultModel,
    modelOverride: j.payload?.model || j.model || null,
    usesDefaultModel: !(j.payload?.model || j.model),
  }));

  res.json(stripSecrets({ version: jobs?.version || 1, jobs: enrichedJobs }));
});

router.put("/api/cron/:jobId", express.json(), (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.jobId)) {
    return res.status(400).json({ error: "Invalid job ID" });
  }
  const jobsPath = path.join(OPENCLAW_HOME, "cron", "jobs.json");
  const data = safeJSON(jobsPath);
  if (!data) return res.status(500).json({ error: "Cannot read jobs file" });

  const jobIndex = data.jobs.findIndex((j) => j.id === req.params.jobId);
  if (jobIndex === -1) return res.status(404).json({ error: "Job not found" });

  try {
    fs.copyFileSync(jobsPath, jobsPath + ".bak");
  } catch {}

  const updates = req.body;
  const job = data.jobs[jobIndex];
  const editable = [
    "name",
    "enabled",
    "agentId",
    "schedule",
    "sessionTarget",
    "wakeMode",
    "payload",
    "delivery",
  ];
  for (const key of editable) {
    if (updates[key] !== undefined) job[key] = updates[key];
  }

  if (job.sessionTarget === "main" && job.payload?.kind !== "systemEvent")
    job.payload.kind = "systemEvent";
  if (job.sessionTarget === "isolated" && job.payload?.kind !== "agentTurn")
    job.payload.kind = "agentTurn";
  job.updatedAtMs = Date.now();

  try {
    fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ error: "Failed to write jobs file" });
  }
});

router.post("/api/cron/:jobId/toggle", (req, res) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(req.params.jobId)) {
    return res.status(400).json({ error: "Invalid job ID" });
  }
  const jobsPath = path.join(OPENCLAW_HOME, "cron", "jobs.json");
  const data = safeJSON(jobsPath);
  if (!data) return res.status(500).json({ error: "Cannot read jobs file" });

  const job = data.jobs.find((j) => j.id === req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });

  try {
    fs.copyFileSync(jobsPath, jobsPath + ".bak");
  } catch {}
  job.enabled = !job.enabled;
  job.updatedAtMs = Date.now();

  try {
    fs.writeFileSync(jobsPath, JSON.stringify(data, null, 2));
    res.json({ ok: true, enabled: job.enabled });
  } catch (err) {
    res.status(500).json({ error: "Failed to write jobs file" });
  }
});

module.exports = router;
