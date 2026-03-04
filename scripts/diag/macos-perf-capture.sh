#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
SERVER_URL="${HUD_SERVER_URL:-http://127.0.0.1:3777}"
ENDPOINT_PATH="${HUD_PERF_SYSTEM_ENDPOINT:-/api/diag/perf/system}"
RUN_ID="${HUD_PERF_RUN_ID:-}"
SOURCE="${HUD_PERF_SOURCE:-viewer-macos}"
INTERVAL_SECONDS="${HUD_PERF_CAPTURE_INTERVAL_SECONDS:-5}"
MAX_ITERATIONS="${HUD_PERF_CAPTURE_MAX_ITERATIONS:-0}"
SHOW_JSON="${HUD_PERF_SHOW_JSON:-0}"
DRY_RUN="${HUD_PERF_DRY_RUN:-0}"

usage() {
  cat <<'EOF'
Usage: macos-perf-capture.sh [options]

Required:
  --run-id <runId>        Shared run id for this capture session

Options:
  --server <url>          HUD server URL (default: http://127.0.0.1:3777)
  --source <source>       Source label in payload (default: viewer-macos)
  --interval <seconds>    Poll interval in seconds (default: 5)
  --once                  Capture once and exit
  --count <N>             Capture N times then exit (default: 0 = forever)
  --dry-run               Build payload and print instead of POSTing
  --show-json             Print JSON payload each sample
  -h, --help              Show this help text

Environment fallbacks:
  HUD_SERVER_URL
  HUD_PERF_SYSTEM_ENDPOINT
  HUD_PERF_RUN_ID
  HUD_PERF_SOURCE
  HUD_PERF_CAPTURE_INTERVAL_SECONDS
  HUD_PERF_CAPTURE_MAX_ITERATIONS
  HUD_PERF_DRY_RUN
  HUD_PERF_SHOW_JSON
EOF
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

extract_number() {
  local input="$1"
  local pattern="$2"
  printf '%s\n' "$input" | awk -v pat="$pattern" '
    BEGIN { IGNORECASE = 1; }
    $0 ~ pat {
      if (match($0, /-?[0-9]+(\.[0-9]+)?/, m)) {
        print m[0];
        exit;
      }
    }
  '
}

capture_powermetrics() {
  local -n out_gpu="$1"
  local -n out_cpu="$2"
  local -n out_package="$3"
  local -n out_pressure="$4"
  local -n out_status="$5"

  local output
  local capture_error=""
  out_status="powermetrics_attempts=1 powermetrics_failures=1 powermetrics_successes=0 powermetrics_unavailable=0"

  if ! command -v powermetrics >/dev/null 2>&1; then
    out_status="powermetrics_attempts=1 powermetrics_failures=1 powermetrics_successes=0 powermetrics_unavailable=1"
    return 0
  fi

  if output="$(sudo -n powermetrics -n 1 -i 1 --samplers gpu_power,thermal 2>&1)"; then
    out_gpu="$(extract_number "$output" "gpu power")"
    out_cpu="$(extract_number "$output" "cpu power")"
    out_package="$(extract_number "$output" "package power")"
    out_pressure="$(extract_number "$output" "thermal pressure")"
    out_status="powermetrics_attempts=1 powermetrics_failures=0 powermetrics_successes=1 powermetrics_unavailable=0"
    return 0
  fi

  capture_error="$(printf '%s' "$output" | tr '\n' ' ')"
  if printf '%s' "$capture_error" | grep -qi "permission denied\|not authorized"; then
    out_status="powermetrics_attempts=1 powermetrics_failures=1 powermetrics_successes=0 powermetrics_unavailable=1"
  else
    out_status="powermetrics_attempts=1 powermetrics_failures=1 powermetrics_successes=0 powermetrics_unavailable=0"
  fi

  return 0
}

capture_thermlog() {
  local -n out_cpu_temp="$1"
  local -n out_gpu_temp="$2"
  local -n out_skin_temp="$3"
  local -n out_pressure="$4"
  local -n out_status="$5"

  local output
  local capture_error=""
  out_status="thermlog_attempts=1 thermlog_failures=1 thermlog_successes=0 thermlog_unavailable=0"

  if ! command -v pmset >/dev/null 2>&1; then
    out_status="thermlog_attempts=1 thermlog_failures=1 thermlog_successes=0 thermlog_unavailable=1"
    return 0
  fi

  output="$(pmset -g thermlog 2>&1 || true)"
  if [ -z "$output" ]; then
    out_status="thermlog_attempts=1 thermlog_failures=1 thermlog_successes=0 thermlog_unavailable=0"
    return 0
  fi

  out_cpu_temp="$(extract_number "$output" "cpu")"
  out_gpu_temp="$(extract_number "$output" "gpu")"
  out_skin_temp="$(extract_number "$output" "skin")"
  out_pressure="$(extract_number "$output" "thermal")"
  out_status="thermlog_attempts=1 thermlog_failures=0 thermlog_successes=1 thermlog_unavailable=0"
}

build_payload() {
  local run_id="$1"
  local source="$2"
  local ts="$3"
  local -n gpu_power="$4"
  local -n cpu_power="$5"
  local -n package_power="$6"
  local -n thermal_pressure="$7"
  local -n thermal_cpu="$8"
  local -n thermal_gpu="$9"
  local -n thermal_skin="$10"
  local -n capture_status="$11"

  if command -v jq >/dev/null 2>&1; then
    local json
    json="$(jq -n \
      --arg runId "$run_id" \
      --arg source "$source" \
      --arg ts "$ts" \
      --argjson gpuPowerW "${gpu_power:-0}" \
      --argjson cpuPowerW "${cpu_power:-0}" \
      --argjson packagePowerW "${package_power:-0}" \
      --argjson pressure "${thermal_pressure:-0}" \
      --argjson cpuTempC "${thermal_cpu:-0}" \
      --argjson gpuTempC "${thermal_gpu:-0}" \
      --argjson skinTempC "${thermal_skin:-0}" \
      --argjson pAttempts "${capture_status[powermetrics_attempts]}" \
      --argjson pFailures "${capture_status[powermetrics_failures]}" \
      --argjson pSuccess "${capture_status[powermetrics_successes]}" \
      --argjson pUnavailable "${capture_status[powermetrics_unavailable]}" \
      --argjson tAttempts "${capture_status[thermlog_attempts]}" \
      --argjson tFailures "${capture_status[thermlog_failures]}" \
      --argjson tSuccess "${capture_status[thermlog_successes]}" \
      --argjson tUnavailable "${capture_status[thermlog_unavailable]}" \
      '{
        runId: $runId,
        source: $source,
        ts: $ts,
        power: {
          gpuPowerW: $gpuPowerW,
          cpuPowerW: $cpuPowerW,
          packagePowerW: $packagePowerW,
          thermalPressure: $pressure
        },
        thermal: {
          cpuTempC: $cpuTempC,
          gpuTempC: $gpuTempC,
          skinTempC: $skinTempC,
          thermalPressure: $pressure
        },
        capture: {
          powermetricsAttempts: $pAttempts,
          powermetricsFailures: $pFailures,
          powermetricsSuccesses: $pSuccess,
          powermetricsUnavailable: $pUnavailable,
          thermlogAttempts: $tAttempts,
          thermlogFailures: $tFailures,
          thermlogSuccesses: $tSuccess,
          thermlogUnavailable: $tUnavailable
        }
      }')"
    printf '%s' "$json"
    return
  fi

  cat <<EOF
{"runId":"$(json_escape "$run_id")","source":"$(json_escape "$source")","ts":"$(json_escape "$ts")","power":{"gpuPowerW":${gpu_power:-0},"cpuPowerW":${cpu_power:-0},"packagePowerW":${package_power:-0},"thermalPressure":${thermal_pressure:-0}},"thermal":{"cpuTempC":${thermal_cpu:-0},"gpuTempC":${thermal_gpu:-0},"skinTempC":${thermal_skin:-0},"thermalPressure":${thermal_pressure:-0}},"capture":{"powermetricsAttempts":${capture_status[powermetrics_attempts]},"powermetricsFailures":${capture_status[powermetrics_failures]},"powermetricsSuccesses":${capture_status[powermetrics_successes]},"powermetricsUnavailable":${capture_status[powermetrics_unavailable]},"thermlogAttempts":${capture_status[thermlog_attempts]},"thermlogFailures":${capture_status[thermlog_failures]},"thermlogSuccesses":${capture_status[thermlog_successes]},"thermlogUnavailable":${capture_status[thermlog_unavailable]}}}
EOF
}

send_payload() {
  local payload="$1"
  local endpoint="$SERVER_URL$ENDPOINT_PATH"
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$payload"
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to post payloads." >&2
    return 1
  fi

  local http_code
  http_code="$(curl -sS -o /tmp/openclaw-hud-perf-http-body.txt -w "%{http_code}" -X POST "$endpoint" \
    -H "content-type: application/json" \
    -d "$payload")"
  if [ "$http_code" = "202" ]; then
    return 0
  fi
  echo "Failed POST to $endpoint with HTTP $http_code" >&2
  return 1
}

parse_status_value() {
  local status_line="$1"
  local key="$2"
  local value
  value="$(printf '%s ' "$status_line" | sed -n "s/.*$key=\\([0-9]\\+\\).*/\\1/p")"
  if [ -z "$value" ]; then
    value=0
  fi
  printf '%s' "$value"
}

capture_once() {
  local power_gpu=""
  local power_cpu=""
  local power_package=""
  local thermal_pressure=""
  local thermal_cpu=""
  local thermal_gpu=""
  local thermal_skin=""
  local pm_output=""
  local pm_status_string=""
  local pow_status_string=""
  local -A capture_status

  pow_status_string=""
  pm_status_string=""

  capture_powermetrics power_gpu power_cpu power_package thermal_pressure pow_status_string
  capture_thermlog thermal_cpu thermal_gpu thermal_skin thermal_pressure pm_status_string

  capture_status[powermetrics_attempts]="$(parse_status_value "$pow_status_string" "powermetrics_attempts")"
  capture_status[powermetrics_failures]="$(parse_status_value "$pow_status_string" "powermetrics_failures")"
  capture_status[powermetrics_successes]="$(parse_status_value "$pow_status_string" "powermetrics_successes")"
  capture_status[powermetrics_unavailable]="$(parse_status_value "$pow_status_string" "powermetrics_unavailable")"
  capture_status[thermlog_attempts]="$(parse_status_value "$pm_status_string" "thermlog_attempts")"
  capture_status[thermlog_failures]="$(parse_status_value "$pm_status_string" "thermlog_failures")"
  capture_status[thermlog_successes]="$(parse_status_value "$pm_status_string" "thermlog_successes")"
  capture_status[thermlog_unavailable]="$(parse_status_value "$pm_status_string" "thermlog_unavailable")"

  local payload
  payload="$(build_payload "$RUN_ID" "$SOURCE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    power_gpu power_cpu power_package thermal_pressure thermal_cpu thermal_gpu thermal_skin capture_status)"

  if [ "$SHOW_JSON" = "1" ]; then
    printf '%s\n' "$payload"
  fi
  send_payload "$payload"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --run-id)
        RUN_ID="${2:-}"
        shift 2
        ;;
      --server)
        SERVER_URL="${2:-}"
        shift 2
        ;;
      --source)
        SOURCE="${2:-}"
        shift 2
        ;;
      --interval)
        INTERVAL_SECONDS="${2:-}"
        shift 2
        ;;
      --once)
        MAX_ITERATIONS=1
        shift
        ;;
      --count)
        MAX_ITERATIONS="${2:-}"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --show-json)
        SHOW_JSON=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage
        exit 2
        ;;
    esac
  done
}

parse_args "$@"

if [ -z "$RUN_ID" ]; then
  RUN_ID="run-$(date +%s)-$(hostname | tr '[:lower:]' '[:upper:]' | sed 's/[^A-Z0-9_-]/_/g')-$$"
fi

if [ "$MAX_ITERATIONS" != "0" ] && ! [[ "$MAX_ITERATIONS" =~ ^[0-9]+$ ]]; then
  echo "--count expects a positive integer" >&2
  exit 2
fi

if ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || [ "$INTERVAL_SECONDS" -lt 1 ]; then
  echo "--interval expects an integer >= 1" >&2
  exit 2
fi

if [ "$MAX_ITERATIONS" = "0" ]; then
  while true; do
    capture_once
    sleep "$INTERVAL_SECONDS"
  done
else
  ITERATION=0
  while [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; do
    ITERATION=$((ITERATION + 1))
    capture_once
    if [ "$ITERATION" -lt "$MAX_ITERATIONS" ]; then
      sleep "$INTERVAL_SECONDS"
    fi
  done
fi

