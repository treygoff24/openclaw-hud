const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { Router } = require('express');
const { getGatewayConfig } = require('../lib/helpers');

const router = Router();

// Rate limiter — in-memory, resets on server restart (intentional for single-user local use)
const spawnTimestamps = [];
const MAX_SPAWNS_PER_MINUTE = 5;

const ALLOWED_ROOTS = [
  path.join(os.homedir(), 'Development'),
  path.join(os.homedir(), '.openclaw'),
  path.join(os.homedir(), 'Dropbox'),
];

function validateContextFiles(filesText) {
  const files = filesText.trim().split('\n').map(f => f.trim()).filter(Boolean);
  if (files.length > 20) return { error: 'Max 20 context files' };
  for (const f of files) {
    const resolved = path.resolve(f.replace(/^~/, os.homedir()));
    if (!ALLOWED_ROOTS.some(root => resolved.startsWith(root + path.sep) || resolved === root)) {
      return { error: `File not in allowed directory: ${f}` };
    }
    try {
      const real = fs.realpathSync(resolved);
      if (!ALLOWED_ROOTS.some(root => real.startsWith(root + path.sep) || real === root)) {
        return { error: `Path escapes allowed directory via symlink: ${f}` };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') return { error: `Cannot resolve path: ${f}` };
    }
  }
  return { valid: files };
}

// Cached model list for resolving aliases
let cachedModels = [];

function resolveAliasFromModel(modelId, modelList) {
  if (!modelId || !modelList) return undefined;
  const entry = modelList.find(m => m.id === modelId || m.model === modelId || m.fullId === modelId);
  return entry?.alias || entry?.name || undefined;
}

router.post('/api/spawn', express.json(), async (req, res) => {
  const { agentId, model, prompt, contextFiles, timeout, mode } = req.body;
  
  // Resolve label from model alias if no label provided (sanitized for valid label format)
  const resolvedAlias = resolveAliasFromModel(model, cachedModels);
  const sanitizedAlias = resolvedAlias && resolvedAlias.replace(/[^a-zA-Z0-9_-]/g, '_');
  const label = req.body.label || sanitizedAlias || undefined;

  // Rate limit
  const now = Date.now();
  while (spawnTimestamps.length && spawnTimestamps[0] < now - 60000) spawnTimestamps.shift();
  if (spawnTimestamps.length >= MAX_SPAWNS_PER_MINUTE) {
    return res.status(429).json({ error: 'Rate limit: max 5 spawns per minute' });
  }

  // Validate
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  if (prompt.length > 50000) return res.status(400).json({ error: 'Prompt too long (max 50,000 chars)' });
  if (!agentId) return res.status(400).json({ error: 'Agent is required' });
  if (mode && !['run', 'session'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
  if (label && !/^[a-zA-Z0-9_-]{1,64}$/.test(label)) return res.status(400).json({ error: 'Invalid label: alphanumeric, hyphens, underscores only (max 64 chars)' });
  if (timeout != null && (timeout < 0 || timeout > 7200)) return res.status(400).json({ error: 'Timeout must be 0-7200 seconds' });

  // Build task prompt
  let task = prompt.trim();
  if (contextFiles?.trim()) {
    const result = validateContextFiles(contextFiles);
    if (result.error) return res.status(400).json({ error: result.error });
    task = `## Context Files\nRead these files first for context:\n${result.valid.map(f => `- \`${f}\``).join('\n')}\n\n## Task\n${task}`;
  }

  // Gateway config
  const gw = getGatewayConfig();
  if (!gw.token) return res.status(500).json({ error: 'Gateway token not configured' });

  spawnTimestamps.push(Date.now());

  try {
    const gwRes = await fetch(`http://127.0.0.1:${gw.port}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${gw.token}`
      },
      body: JSON.stringify({
        tool: 'sessions_spawn',
        args: {
          task,
          mode: mode || 'run',
          ...(model && { model }),
          ...(label && { label }),
          ...(timeout != null && timeout > 0 && { runTimeoutSeconds: timeout })
        }
      })
    });

    if (!gwRes.ok) {
      const errBody = await gwRes.text();
      let detail = errBody;
      try { detail = JSON.parse(errBody).error?.message || errBody; } catch {}
      return res.status(502).json({ error: `Gateway error: ${detail}` });
    }

    const result = await gwRes.json();
    console.log('[spawn] Gateway response:', JSON.stringify(result).slice(0, 500));

    const details = result?.result?.details || result?.details || {};
    res.json({
      ok: true,
      sessionKey: details.childSessionKey || null,
      runId: details.runId || null
    });
  } catch (err) {
    res.status(502).json({ error: `Cannot reach gateway: ${err.message}` });
  }
});

// Export router and cachedModels for external updates
module.exports = router;
module.exports.cachedModels = cachedModels;
module.exports.setCachedModels = (models) => { cachedModels = models; };
