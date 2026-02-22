// Playwright globalSetup: regenerate fixture files with fresh timestamps
const fs = require('fs');
const path = require('path');

module.exports = async function globalSetup() {
  const now = Date.now();
  const FIVE_MIN_AGO = now - 5 * 60 * 1000;
  const TEN_MIN_AGO = now - 10 * 60 * 1000;

  const sessionsJson = {
    "agent:test-agent:main": {
      sessionId: "sess-abc-001",
      updatedAt: FIVE_MIN_AGO,
      label: "main",
      lastChannel: "discord",
      spawnDepth: 0
    },
    "agent:test-agent:subagent:research": {
      sessionId: "sess-abc-002",
      updatedAt: TEN_MIN_AGO,
      label: "research-task",
      spawnedBy: "agent:test-agent:main",
      spawnDepth: 1,
      lastChannel: "discord"
    }
  };

  const sessDir = path.join(__dirname, 'openclaw-home/agents/test-agent/sessions');
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'sessions.json'), JSON.stringify(sessionsJson, null, 2));

  const ts = (offset) => new Date(now - offset).toISOString();

  const logEntries = [
    { type: "model_change", modelId: "anthropic/claude-sonnet-4", timestamp: ts(600000) },
    { type: "message", role: "system", content: "You are a helpful assistant.", timestamp: ts(590000) },
    { type: "message", role: "user", content: "Hello, can you help me with a coding task?", timestamp: ts(580000) },
    { type: "message", role: "assistant", content: "Of course! I'd be happy to help you with your coding task. What would you like to work on?", timestamp: ts(570000), message: { model: "anthropic/claude-sonnet-4", usage: { input: 150, output: 30, cacheRead: 0, cacheWrite: 100, totalTokens: 280, cost: { total: 0.0042 } } } },
    { type: "message", role: "user", content: "Write a function that sorts an array of objects by a given key.", timestamp: ts(560000) },
    { type: "tool_use", name: "write_file", content: "Writing sort function to utils.js", timestamp: ts(550000) },
    { type: "tool_result", name: "write_file", content: "File written successfully", timestamp: ts(545000) },
    { type: "message", role: "assistant", content: "I've written the sort function for you.", timestamp: ts(540000), message: { model: "anthropic/claude-sonnet-4", usage: { input: 300, output: 80, cacheRead: 100, cacheWrite: 0, totalTokens: 480, cost: { total: 0.0065 } } } },
    { type: "message", role: "user", content: "Perfect, thanks!", timestamp: ts(530000) },
    { type: "message", role: "assistant", content: "You're welcome! Let me know if you need anything else.", timestamp: ts(520000), message: { model: "anthropic/claude-sonnet-4", usage: { input: 400, output: 15, cacheRead: 200, cacheWrite: 0, totalTokens: 615, cost: { total: 0.003 } } } },
  ];

  fs.writeFileSync(
    path.join(sessDir, 'sess-abc-001.jsonl'),
    logEntries.map(e => JSON.stringify(e)).join('\n') + '\n'
  );

  // Also create a minimal log for sess-abc-002
  const log2 = [
    { type: "message", role: "user", content: "Research quantum computing advances.", timestamp: ts(500000) },
    { type: "message", role: "assistant", content: "I'll research the latest quantum computing advances for you.", timestamp: ts(490000), message: { model: "anthropic/claude-sonnet-4", usage: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 70, cost: { total: 0.001 } } } },
  ];
  fs.writeFileSync(
    path.join(sessDir, 'sess-abc-002.jsonl'),
    log2.map(e => JSON.stringify(e)).join('\n') + '\n'
  );
};
