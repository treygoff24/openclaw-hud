#!/usr/bin/env bash
set -euo pipefail

# Installs an idempotent cron entry that archives the just-ended previous week
# every Sunday shortly after midnight (server local time).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
RUN_MINUTE="${WEEKLY_ARCHIVE_MINUTE:-5}"
RUN_HOUR="${WEEKLY_ARCHIVE_HOUR:-0}"
HUD_USAGE_TZ="${HUD_USAGE_TZ:-America/Chicago}"
LOG_DIR="$OPENCLAW_HOME/logs"
LOG_FILE="$LOG_DIR/weekly-usage-archive.log"
MARKER="# openclaw-hud-weekly-usage-archive"

mkdir -p "$LOG_DIR"

ARCHIVE_CMD="cd '$ROOT_DIR' && OPENCLAW_HOME='$OPENCLAW_HOME' HUD_USAGE_TZ='$HUD_USAGE_TZ' node ./scripts/weekly-usage-archive.js >> '$LOG_FILE' 2>&1"
CRON_LINE="${RUN_MINUTE} ${RUN_HOUR} * * 0 ${ARCHIVE_CMD} ${MARKER}"

CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"
FILTERED_CRONTAB="$(printf '%s\n' "$CURRENT_CRONTAB" | grep -v "$MARKER" || true)"

{
  if [ -n "$FILTERED_CRONTAB" ]; then
    printf '%s\n' "$FILTERED_CRONTAB"
  fi
  printf '%s\n' "$CRON_LINE"
} | crontab -

echo "Installed weekly archive cron job:"
echo "$CRON_LINE"
echo "Log file: $LOG_FILE"
