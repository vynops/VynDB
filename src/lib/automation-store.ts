import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const DATA_DIR = path.join(process.cwd(), 'data')
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }) }
function load<T>(file: string, def: T): T {
  ensureDir()
  const p = path.join(DATA_DIR, file)
  if (!fs.existsSync(p)) return def
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return def }
}
function save<T>(file: string, data: T) {
  ensureDir()
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8')
}

// ────────── Types ──────────

export type AutomationTrigger = 'cron' | 'threshold' | 'manual'
export type AutomationActionType = 'vacuum' | 'analyze' | 'reindex' | 'kill_idle' | 'custom_sql' | 'slack_notify' | 'email_notify'
export type RunStatus = 'success' | 'failed' | 'running' | 'skipped'
export type AutonomousStatus = 'pending' | 'approved' | 'executed' | 'dismissed' | 'failed'
export type AutonomousRisk = 'low' | 'medium' | 'high'
export type AutonomousActionType = 'vacuum' | 'analyze' | 'reindex' | 'kill_query' | 'config_change' | 'index_create' | 'connection_limit' | 'custom'

export interface AutomationAction {
  type: AutomationActionType
  sql?: string
  message?: string
}

export interface AutomationRun {
  id: string
  ruleId: string
  startedAt: string
  completedAt: string
  status: RunStatus
  output: string
  triggeredBy: 'cron' | 'manual' | 'threshold'
}

export interface AutomationRule {
  id: string
  name: string
  description: string
  dbId: string        // '*' = all
  dbName: string
  trigger: AutomationTrigger
  cronExpr?: string
  cronLabel?: string
  thresholdMetric?: string
  thresholdOperator?: '>' | '<' | '>=' | '<='
  thresholdValue?: number
  actions: AutomationAction[]
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: RunStatus
  lastRunOutput?: string
  nextRunAt?: string
  runCount: number
  createdAt: string
  tags: string[]
}

export interface AutonomousProposal {
  id: string
  source: 'slow_query' | 'performance' | 'incident' | 'capacity' | 'security' | 'ai_scan'
  title: string
  description: string
  dbId: string
  dbName: string
  engine: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  actionType: AutonomousActionType
  proposedAction: string
  sql?: string
  risk: AutonomousRisk
  confidence: number
  estimatedGain: string
  status: AutonomousStatus
  autoExecuteEnabled: boolean
  createdAt: string
  executedAt?: string
  executedBy?: string
  executionOutput?: string
}

// ────────── Demo Data ──────────

const now = () => new Date().toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
const nextHour = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

const DEMO_RULES: AutomationRule[] = [
  {
    id: 'rule-001',
    name: 'Daily VACUUM ANALYZE — prod-postgres',
    description: 'Reclaim dead tuples and refresh planner statistics on all tables in production',
    dbId: 'db-001', dbName: 'prod-postgres',
    trigger: 'cron', cronExpr: '0 2 * * *', cronLabel: 'Daily at 02:00 UTC',
    actions: [
      { type: 'vacuum', sql: 'VACUUM ANALYZE;' },
      { type: 'slack_notify', message: '✅ VACUUM ANALYZE completed on prod-postgres' },
    ],
    enabled: true,
    lastRunAt: hoursAgo(22), lastRunStatus: 'success', lastRunOutput: 'VACUUM ANALYZE\nTime: 4.2s | Tables scanned: 47 | Dead tuples removed: 128,440',
    nextRunAt: nextHour(2), runCount: 38, createdAt: hoursAgo(900), tags: ['maintenance', 'postgresql'],
  },
  {
    id: 'rule-002',
    name: 'Kill Idle Connections >30min — prod-mysql',
    description: 'Terminate idle connections that have been open for more than 30 minutes to free pool capacity',
    dbId: 'db-002', dbName: 'prod-mysql',
    trigger: 'cron', cronExpr: '*/15 * * * *', cronLabel: 'Every 15 minutes',
    actions: [
      { type: 'kill_idle', sql: "SELECT CONCAT('KILL ', id, ';') FROM information_schema.processlist WHERE command = 'Sleep' AND time > 1800;" },
    ],
    enabled: true,
    lastRunAt: hoursAgo(0.3), lastRunStatus: 'success', lastRunOutput: 'Killed 3 idle connections (IDs: 204, 211, 219)\nPool freed: 3 slots',
    nextRunAt: nextHour(0.25), runCount: 192, createdAt: hoursAgo(720), tags: ['connections', 'mysql'],
  },
  {
    id: 'rule-003',
    name: 'Weekly REINDEX — analytics-oracle',
    description: 'Rebuild fragmented indexes on the analytics Oracle schema every Sunday night',
    dbId: 'db-004', dbName: 'analytics-oracle',
    trigger: 'cron', cronExpr: '0 3 * * 0', cronLabel: 'Sundays at 03:00 UTC',
    actions: [
      { type: 'reindex', sql: 'ALTER INDEX ALL ON ANALYTICS.EVENTS REBUILD ONLINE;' },
    ],
    enabled: true,
    lastRunAt: hoursAgo(72), lastRunStatus: 'success', lastRunOutput: 'Rebuilt 12 indexes\nAvg fragmentation before: 34% → after: 2%\nDuration: 18.4s',
    nextRunAt: nextHour(96), runCount: 14, createdAt: hoursAgo(2200), tags: ['maintenance', 'oracle', 'indexes'],
  },
  {
    id: 'rule-004',
    name: 'Alert on Slow Query Spike',
    description: 'Send Slack alert when slow query count exceeds 10 in a 5-minute window',
    dbId: '*', dbName: 'All databases',
    trigger: 'threshold', thresholdMetric: 'slow_query_count', thresholdOperator: '>', thresholdValue: 10,
    actions: [
      { type: 'slack_notify', message: '⚠️ Slow query spike detected: {{count}} slow queries in 5 minutes on {{db}}' },
      { type: 'email_notify', message: 'Slow query spike on {{db}}: {{count}} queries exceeded threshold' },
    ],
    enabled: true,
    lastRunAt: hoursAgo(6), lastRunStatus: 'success', lastRunOutput: 'Notification sent to #db-alerts channel\nTrigger: 14 slow queries on prod-postgres in 5 min',
    runCount: 7, createdAt: hoursAgo(500), tags: ['alerting', 'slow-queries'],
  },
  {
    id: 'rule-005',
    name: 'MongoDB Compact Collections — app-mongodb',
    description: 'Run compact command on largest collections to reclaim disk space monthly',
    dbId: 'db-006', dbName: 'app-mongodb',
    trigger: 'cron', cronExpr: '0 4 1 * *', cronLabel: '1st of month at 04:00 UTC',
    actions: [
      { type: 'custom_sql', sql: 'db.runCommand({ compact: "events" })\ndb.runCommand({ compact: "logs" })' },
    ],
    enabled: false,
    lastRunAt: hoursAgo(500), lastRunStatus: 'failed', lastRunOutput: 'Error: compact requires exclusive lock. Retrying with allowInterrupt...\nFailed after 3 retries',
    nextRunAt: nextHour(300), runCount: 3, createdAt: hoursAgo(1500), tags: ['maintenance', 'mongodb', 'disk'],
  },
  {
    id: 'rule-006',
    name: 'Redis Memory Flush Expired Keys',
    description: 'Trigger active expiry sweep on Redis when memory exceeds 80%',
    dbId: 'db-005', dbName: 'cache-redis',
    trigger: 'threshold', thresholdMetric: 'mem_pct', thresholdOperator: '>=', thresholdValue: 80,
    actions: [
      { type: 'custom_sql', sql: 'DEBUG SLEEP 0\nDEBUG JMAP' },
      { type: 'slack_notify', message: '🔴 Redis memory ≥80% — triggered active key expiry sweep on cache-redis' },
    ],
    enabled: true,
    lastRunAt: hoursAgo(48), lastRunStatus: 'success', lastRunOutput: 'Active expiry sweep triggered\nExpired keys removed: 24,180\nMemory reclaimed: ~180 MB',
    runCount: 5, createdAt: hoursAgo(400), tags: ['redis', 'memory'],
  },
]

const DEMO_RUNS: AutomationRun[] = [
  { id: 'run-001', ruleId: 'rule-001', startedAt: hoursAgo(22), completedAt: hoursAgo(21.93), status: 'success', output: 'VACUUM ANALYZE\nTime: 4.2s | Tables scanned: 47 | Dead tuples removed: 128,440', triggeredBy: 'cron' },
  { id: 'run-002', ruleId: 'rule-002', startedAt: hoursAgo(0.3), completedAt: hoursAgo(0.29), status: 'success', output: 'Killed 3 idle connections (IDs: 204, 211, 219)\nPool freed: 3 slots', triggeredBy: 'cron' },
  { id: 'run-003', ruleId: 'rule-003', startedAt: hoursAgo(72), completedAt: hoursAgo(71.7), status: 'success', output: 'Rebuilt 12 indexes\nAvg fragmentation before: 34% → after: 2%\nDuration: 18.4s', triggeredBy: 'cron' },
  { id: 'run-004', ruleId: 'rule-005', startedAt: hoursAgo(500), completedAt: hoursAgo(499.9), status: 'failed', output: 'Error: compact requires exclusive lock. Retrying with allowInterrupt...\nFailed after 3 retries', triggeredBy: 'cron' },
  { id: 'run-005', ruleId: 'rule-001', startedAt: hoursAgo(46), completedAt: hoursAgo(45.92), status: 'success', output: 'VACUUM ANALYZE\nTime: 3.8s | Tables scanned: 47 | Dead tuples removed: 91,200', triggeredBy: 'cron' },
  { id: 'run-006', ruleId: 'rule-004', startedAt: hoursAgo(6), completedAt: hoursAgo(5.99), status: 'success', output: 'Notification sent to #db-alerts channel\nTrigger: 14 slow queries on prod-postgres in 5 min', triggeredBy: 'threshold' },
]

const DEMO_PROPOSALS: AutonomousProposal[] = [
  {
    id: 'auto-001',
    source: 'slow_query',
    title: 'Create missing index on orders.customer_id',
    description: 'Query analyzer detected 847 sequential scans/day on orders table. Adding a covering index will eliminate full-table scans affecting 23% of all queries.',
    dbId: 'db-001', dbName: 'prod-postgres', engine: 'postgresql',
    severity: 'critical', actionType: 'index_create', risk: 'low',
    proposedAction: 'CREATE INDEX CONCURRENTLY on orders(customer_id) INCLUDE (status, total)',
    sql: 'CREATE INDEX CONCURRENTLY idx_orders_customer_id_covering\nON orders(customer_id)\nINCLUDE (status, total, created_at);',
    confidence: 96, estimatedGain: '92% query time reduction for customer order lookups',
    status: 'pending', autoExecuteEnabled: false,
    createdAt: hoursAgo(2),
  },
  {
    id: 'auto-002',
    source: 'performance',
    title: 'VACUUM required — users table has 38% dead tuples',
    description: 'Bloat analysis shows 38% dead tuple ratio on the users table (2.1M live rows, 1.3M dead). This is degrading index scans and wasting 680 MB of disk space.',
    dbId: 'db-001', dbName: 'prod-postgres', engine: 'postgresql',
    severity: 'high', actionType: 'vacuum', risk: 'low',
    proposedAction: 'VACUUM (VERBOSE, ANALYZE) users;',
    sql: 'VACUUM (VERBOSE, ANALYZE) users;\n-- Expected: removes ~1.3M dead tuples, reclaims ~680 MB',
    confidence: 98, estimatedGain: '680 MB disk reclaimed, 25-40% faster index scans on users',
    status: 'pending', autoExecuteEnabled: false,
    createdAt: hoursAgo(4),
  },
  {
    id: 'auto-003',
    source: 'performance',
    title: 'Kill 12 idle connections blocking pool saturation',
    description: '12 connections have been idle >45 minutes and are occupying 20% of the connection pool. Active queries are beginning to queue.',
    dbId: 'db-002', dbName: 'prod-mysql', engine: 'mysql',
    severity: 'high', actionType: 'kill_query', risk: 'low',
    proposedAction: 'Kill 12 idle connections (SLEEP state, idle >45 min)',
    sql: '-- Kill idle connections (>45 minutes, SLEEP state)\nSELECT CONCAT(\'KILL \', id, \';\') FROM information_schema.processlist\nWHERE command = \'Sleep\' AND time > 2700;\n-- Execute each KILL statement above',
    confidence: 94, estimatedGain: 'Free 12 connection slots, eliminate queue backpressure',
    status: 'pending', autoExecuteEnabled: true,
    createdAt: hoursAgo(0.5),
  },
  {
    id: 'auto-004',
    source: 'capacity',
    title: 'Table statistics stale on analytics_events (45 days old)',
    description: 'Planner statistics for analytics_events have not been updated in 45 days. Row estimate error is causing the query planner to choose nested-loop joins over hash joins.',
    dbId: 'db-001', dbName: 'prod-postgres', engine: 'postgresql',
    severity: 'medium', actionType: 'analyze', risk: 'low',
    proposedAction: 'ANALYZE analytics_events;',
    sql: 'ANALYZE analytics_events;\n-- Also update stats for dependent tables\nANALYZE analytics_sessions;',
    confidence: 91, estimatedGain: 'Correct query plan selection, up to 8x faster analytics queries',
    status: 'pending', autoExecuteEnabled: false,
    createdAt: hoursAgo(8),
  },
  {
    id: 'auto-005',
    source: 'performance',
    title: 'Redis maxmemory-policy change recommended',
    description: 'Redis memory is at 87% with default noeviction policy. This will cause write errors when full. Switching to allkeys-lru is appropriate for this cache-only workload.',
    dbId: 'db-005', dbName: 'cache-redis', engine: 'redis',
    severity: 'medium', actionType: 'config_change', risk: 'medium',
    proposedAction: 'Set maxmemory-policy to allkeys-lru',
    sql: 'CONFIG SET maxmemory-policy allkeys-lru\nCONFIG REWRITE\n-- Verify: CONFIG GET maxmemory-policy',
    confidence: 88, estimatedGain: 'Prevent OOM write errors, automatic key eviction under pressure',
    status: 'pending', autoExecuteEnabled: false,
    createdAt: hoursAgo(12),
  },
  {
    id: 'auto-006',
    source: 'slow_query',
    title: 'Compound index missing on MongoDB events collection',
    description: 'Aggregation pipeline on events collection uses COLLSCAN (full collection scan) due to missing compound index on {user_id, timestamp}. 340 slow queries/day attributed to this.',
    dbId: 'db-006', dbName: 'app-mongodb', engine: 'mongodb',
    severity: 'medium', actionType: 'index_create', risk: 'low',
    proposedAction: 'db.events.createIndex({ user_id: 1, timestamp: -1 })',
    sql: 'db.events.createIndex(\n  { user_id: 1, timestamp: -1 },\n  { background: true, name: "idx_events_user_ts" }\n)',
    confidence: 93, estimatedGain: '95% reduction in slow aggregation queries on events',
    status: 'executed', autoExecuteEnabled: false,
    createdAt: hoursAgo(36), executedAt: hoursAgo(24),
    executedBy: 'admin@vyndb.local',
    executionOutput: 'Index created: idx_events_user_ts\nBuild time: 12.3s\nDocuments indexed: 4,280,000',
  },
  {
    id: 'auto-007',
    source: 'security',
    title: 'Limit max_connections on SQL Server reporting instance',
    description: 'SQL Server reporting instance has no connection limit configured. A runaway ETL job could exhaust server capacity. Recommend cap at 200 connections.',
    dbId: 'db-007', dbName: 'reports-sqlserver', engine: 'sqlserver',
    severity: 'low', actionType: 'connection_limit', risk: 'medium',
    proposedAction: 'Set max connections to 200 via sp_configure',
    sql: "EXEC sp_configure 'max connections', 200;\nRECONFIGURE WITH OVERRIDE;\nGO",
    confidence: 78, estimatedGain: 'Prevent runaway connection exhaustion on reporting instance',
    status: 'dismissed', autoExecuteEnabled: false,
    createdAt: hoursAgo(48),
  },
]

// ────────── Automation Rules ──────────

export function loadRules(): AutomationRule[] { return load('automation-rules.json', DEMO_RULES) }
export function saveRule(r: AutomationRule): void {
  const list = loadRules()
  const idx = list.findIndex(x => x.id === r.id)
  if (idx === -1) { list.unshift(r) } else { list[idx] = r }
  save('automation-rules.json', list)
}
export function deleteRule(id: string): void {
  save('automation-rules.json', loadRules().filter(r => r.id !== id))
}

// ────────── Run History ──────────

export function loadRuns(): AutomationRun[] { return load('automation-runs.json', DEMO_RUNS) }
export function addRun(run: AutomationRun): void {
  const list = loadRuns()
  list.unshift(run)
  save('automation-runs.json', list.slice(0, 500)) // cap at 500 entries
}

// Simulate running a rule — returns fake output based on action type
export function simulateRun(rule: AutomationRule): { status: RunStatus; output: string } {
  const now = new Date().toISOString()
  const outputs: Record<AutomationActionType, string> = {
    vacuum: `VACUUM ANALYZE on ${rule.dbName}\nTime: ${(Math.random() * 8 + 1).toFixed(1)}s | Tables scanned: ${Math.floor(Math.random() * 60 + 10)} | Dead tuples removed: ${(Math.random() * 200000 + 5000).toFixed(0)}`,
    analyze: `ANALYZE on ${rule.dbName}\nStatistics updated for ${Math.floor(Math.random() * 50 + 5)} tables\nTime: ${(Math.random() * 3 + 0.5).toFixed(2)}s`,
    reindex: `REINDEX completed on ${rule.dbName}\n${Math.floor(Math.random() * 20 + 3)} indexes rebuilt\nAvg fragmentation: 31% → ${Math.floor(Math.random() * 4 + 1)}%\nDuration: ${(Math.random() * 30 + 5).toFixed(1)}s`,
    kill_idle: `Scanned connection pool on ${rule.dbName}\nIdle connections found: ${Math.floor(Math.random() * 8 + 1)}\nKilled: ${Math.floor(Math.random() * 5 + 1)} connections\nPool slots freed: ${Math.floor(Math.random() * 5 + 1)}`,
    custom_sql: `Executed custom SQL on ${rule.dbName}\nRows affected: ${Math.floor(Math.random() * 1000)}\nExecution time: ${(Math.random() * 5 + 0.1).toFixed(2)}s`,
    slack_notify: `Slack notification sent to #db-alerts\nMessage: ${rule.actions.find(a => a.type === 'slack_notify')?.message ?? 'Alert triggered'}`,
    email_notify: `Email notification dispatched\nRecipients: ops-team@example.com\nSubject: [VynDB] ${rule.name}`,
  }
  const action = rule.actions[0]
  const output = outputs[action.type] ?? `Rule executed: ${rule.name}`
  return { status: 'success', output }
}

// ────────── Autonomous Proposals ──────────

export function loadProposals(): AutonomousProposal[] { return load('autonomous-proposals.json', DEMO_PROPOSALS) }
export function saveProposal(p: AutonomousProposal): void {
  const list = loadProposals()
  const idx = list.findIndex(x => x.id === p.id)
  if (idx === -1) { list.unshift(p) } else { list[idx] = p }
  save('autonomous-proposals.json', list)
}
export function newProposalId(): string { return `auto-${crypto.randomUUID().slice(0, 8)}` }
