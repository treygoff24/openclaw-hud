const fs = require('fs');
const path = require('path');
const { OPENCLAW_HOME } = require('./helpers');

function getUsageArchiveDir(options = {}) {
  const home = typeof options.openclawHome === 'string' && options.openclawHome.trim()
    ? options.openclawHome
    : OPENCLAW_HOME;
  return path.join(home, 'state', 'usage-archive', 'weekly');
}

function toWeekKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid weekStart value: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function getWeekPath(weekStart, options = {}) {
  const archiveDir = getUsageArchiveDir(options);
  const weekKey = toWeekKey(weekStart);
  return {
    weekKey,
    archiveDir,
    path: path.join(archiveDir, `${weekKey}.json`),
  };
}

function writeWeeklySnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('snapshot must be an object');
  }

  const weekStart = snapshot?.meta?.weekStart;
  if (!weekStart) {
    throw new Error('snapshot.meta.weekStart is required');
  }

  const location = getWeekPath(weekStart, options);
  fs.mkdirSync(location.archiveDir, { recursive: true });

  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  fs.writeFileSync(location.path, serialized, { flag: 'wx' });

  return {
    weekKey: location.weekKey,
    path: location.path,
  };
}

function readWeeklySnapshot(weekStart, options = {}) {
  const location = getWeekPath(weekStart, options);

  try {
    const raw = fs.readFileSync(location.path, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }
}

function readWeeklyHistory(options = {}) {
  const archiveDir = getUsageArchiveDir(options);

  let entries = [];
  try {
    entries = fs.readdirSync(archiveDir);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const snapshots = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;

    const filePath = path.join(archiveDir, entry);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.meta && parsed.meta.weekStart) {
        snapshots.push(parsed);
      }
    } catch {
      // Ignore malformed snapshots; keep history readable.
    }
  }

  snapshots.sort((a, b) => {
    const left = String(a?.meta?.weekStart || '');
    const right = String(b?.meta?.weekStart || '');
    return right.localeCompare(left);
  });

  return snapshots;
}

module.exports = {
  getUsageArchiveDir,
  toWeekKey,
  writeWeeklySnapshot,
  readWeeklySnapshot,
  readWeeklyHistory,
};
