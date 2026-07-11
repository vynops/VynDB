#!/bin/bash
# Called by PM2 every 5 minutes:
#   1. Collect real metrics from all lab databases
#   2. Run monitor — evaluate thresholds, detect anomalies, raise incidents
#   3. Execute any backup schedules that are due (per-DB, per-schedule config)
TOKEN="${VYNDB_COLLECTOR_TOKEN:-vyndb_collector_token_lab_2024}"
BASE="http://localhost:3060"
TS="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Step 1: Collect metrics
COLLECT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/collect" \
  -H "Authorization: Bearer $TOKEN" --max-time 120)
echo "$TS Collect: HTTP $COLLECT_CODE"

# Step 2: Monitor (only if collection succeeded)
if [ "$COLLECT_CODE" = "200" ]; then
  MONITOR=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/monitor" \
    -H "Authorization: Bearer $TOKEN" --max-time 60)
  MONITOR_CODE=$(echo "$MONITOR" | tail -1)
  MONITOR_BODY=$(echo "$MONITOR" | head -1)
  echo "$TS Monitor: HTTP $MONITOR_CODE | $MONITOR_BODY"
else
  echo "$TS Monitor: skipped (collection failed)"
fi

# Step 3: Execute backup schedules that are due
SCHED=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/backup-schedules/execute-due" \
  -H "Authorization: Bearer $TOKEN" --max-time 300)
SCHED_CODE=$(echo "$SCHED" | tail -1)
SCHED_BODY=$(echo "$SCHED" | head -1)
echo "$TS Backup schedules: HTTP $SCHED_CODE | $SCHED_BODY"
