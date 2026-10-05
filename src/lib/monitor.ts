/**
 * VynDB Monitor — closes the data loop:
 *   collected metrics → threshold evaluation → automation execution
 *                     → anomaly detection → autonomous proposals
 *                     → critical breaches → incident auto-creation
 *
 * Called by /api/monitor after every /api/collect run.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import {
  loadDatabases, loadSlowQueries, loadCapacity, loadReplication,
  type PerformanceSnapshot, type CapacityEntry, type ReplicationStatus, type SlowQuery,
} from './db-store'
import { loadRules, saveRule, addRun, loadProposals, saveProposal, newProposalId, type AutonomousProposal } from './automation-store'
import { loadIncidents, addIncident, patchIncident, loadEscalations, loadSla } from './incident-store'
import { sendSlack, sendTeams, sendWebhook, sendEmail, notifyIncident } from './notifier'
import { getSettings } from './settings-store'
import { matchRouting } from './incident-store'
import { appendAudit } from './audit-store'
import { isStatusStale } from './status-freshness'

const DATA_DIR = path.join(process.cwd(), 'data')

function loadJson<T>(file: string, def: T): T {
  const p = path.join(DATA_DIR, file)
  if (!fs.existsSync(p)) return def
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return def }
}

function saveJson(file: string, data: unknown) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  const target = path.join(DATA_DIR, file)
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(temp, target)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Latest performance snapshot per DB */
function latestSnapshots(): Map<string, PerformanceSnapshot> {
  const snaps = loadJson<PerformanceSnapshot[]>('perf-snapshots.json', [])
  const latest = new Map<string, PerformanceSnapshot>()
  for (const s of snaps) {
    const ex = latest.get(s.dbId)
    if (!ex || s.timestamp > ex.timestamp) latest.set(s.dbId, s)
  }
  return latest
}

function evalOp(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case '>':  return value > threshold
    case '<':  return value < threshold
    case '>=': return value >= threshold
    case '<=': return value <= threshold
    default:   return false
  }
}

/** Read the current value for a given threshold metric */
function metricValue(
  metric: string,
  dbId: string,
  snapshots: Map<string, PerformanceSnapshot>,
  capacity: CapacityEntry[],
  replication: ReplicationStatus[],
  slowQueries: SlowQuery[],
): number {
  const snap = dbId === '*' ? [...snapshots.values()][0] : snapshots.get(dbId)

  switch (metric) {
    case 'cpu_pct':          return snap?.cpuPct ?? 0
    case 'mem_pct':          return snap?.memPct ?? 0
    case 'conn_pct': {
      if (!snap || snap.maxConnections === 0) return 0
      return Math.round(100 * snap.activeConnections / snap.maxConnections)
    }
    case 'slow_query_count': {
      const cutoff = new Date(Date.now() - 5 * 60000).toISOString()
      const dbs = dbId === '*' ? slowQueries : slowQueries.filter(q => q.dbId === dbId)
      return dbs.filter(q => q.executedAt >= cutoff).length
    }
    case 'replication_lag': {
      const replicas = replication.filter(r => r.role === 'replica' && (dbId === '*' || r.dbId === dbId))
      return replicas.length > 0 ? Math.max(...replicas.map(r => r.lagSeconds)) : 0
    }
    case 'disk_pct': {
      const cap = capacity.find(c => dbId === '*' || c.dbId === dbId)
      if (!cap || cap.totalSizeMB === 0) return 0
      return Math.round(100 * (cap.dataSizeMB + cap.indexSizeMB) / cap.totalSizeMB)
    }
    default: return 0
  }
}

async function dispatch(message: string, subject: string): Promise<void> {
  const settings = getSettings()
  const routing = matchRouting('high', 'performance')
  if (routing.notifySlack) await sendSlack(message).catch(() => {})
  if (routing.notifyTeams) await sendTeams(message).catch(() => {})
  if (routing.notifyWebhook) await sendWebhook({
    alert_type: 'monitor',
    title: subject,
    team: settings.notificationTeam || undefined,
    timestamp: new Date().toISOString(),
    message,
  }).catch(() => {})
  const emails: string[] = [...routing.notifyEmails]
  if (settings.alertRecipients) emails.push(...settings.alertRecipients.split(',').map(e => e.trim()).filter(Boolean))
  if (emails.length > 0) await sendEmail([...new Set(emails)], subject, message).catch(() => {})
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface MonitorResult {
  durationMs: number
  rulesEvaluated: number
  thresholdBreaches: number
  proposalsGenerated: number
  incidentsRaised: number
}

export async function runMonitor(): Promise<MonitorResult> {
  const t0 = Date.now()
  const settings = getSettings()
  const dbs = loadDatabases()
  const active = new Set(dbs.filter(db => db.status === 'connected' || db.status === 'warning').map(db => db.id))
  const snapshots = new Map([...latestSnapshots()].filter(([id, snapshot]) => active.has(id) && !isStatusStale(snapshot.timestamp)))
  const capacity = loadCapacity().filter(entry => active.has(entry.dbId) && entry.collectedAt && !isStatusStale(entry.collectedAt))
  const replication = loadReplication().filter(entry => entry.collectedAt && !isStatusStale(entry.collectedAt) &&
    [...active].some(id => entry.dbId === id || entry.dbId.startsWith(`${id}-`)))
  const slowQueries = loadSlowQueries()

  let thresholdBreaches = 0
  let proposalsGenerated = 0
  let incidentsRaised = 0

  // ── 1. Threshold rule evaluation ─────────────────────────────────────────

  const thresholdRules = loadRules().filter(r => r.enabled && r.trigger === 'threshold')

  for (const rule of thresholdRules) {
    const metric    = rule.thresholdMetric ?? ''
    const op        = rule.thresholdOperator ?? '>'
    const threshold = rule.thresholdValue ?? 0

    const targetDbs = rule.dbId === '*' ? dbs : dbs.filter(d => d.id === rule.dbId)

    for (const db of targetDbs) {
      if (!active.has(db.id)) continue
      const value = metricValue(metric, db.id, snapshots, capacity, replication, slowQueries)
      if (!evalOp(value, op, threshold)) continue

      thresholdBreaches++
      const now = new Date().toISOString()
      const executableActions = rule.actions.filter(action => !['slack_notify', 'email_notify'].includes(action.type))
      const deliveries: string[] = []
      const recipients = [...new Set([
        ...matchRouting('high', 'performance').notifyEmails,
        ...(settings.alertRecipients ?? '').split(',').map(email => email.trim()).filter(Boolean),
      ])]
      for (const action of rule.actions) {
        if (action.type !== 'slack_notify' && action.type !== 'email_notify') continue
        const msg = (action.message ?? rule.name)
          .replaceAll('{{count}}', String(Math.round(value)))
          .replaceAll('{{metric}}', metric)
          .replaceAll('{{value}}', value.toFixed(1))
          .replaceAll('{{db}}', db.name)
        const result = action.type === 'slack_notify'
          ? await sendSlack(msg).catch(() => 'failed' as const)
          : await sendEmail(recipients, `[VynDB Alert] ${rule.name}`, msg).catch(() => 'failed' as const)
        deliveries.push(`${action.type}: ${result}`)
      }

      const status = deliveries.some(delivery => delivery.endsWith('failed')) ? 'failed'
        : executableActions.length > 0 ? 'skipped'
        : deliveries.some(delivery => delivery.endsWith('sent')) ? 'success' : 'skipped'
      const output = `Threshold breach on ${db.name}: ${metric} = ${value.toFixed(1)} ${op} ${threshold}; ` +
        [...deliveries, ...(executableActions.length > 0 ? [`database actions not executed: ${executableActions.map(action => action.type).join(', ')}`] : [])].join('; ')
      addRun({
        id: `run-${crypto.randomUUID().slice(0, 8)}`,
        ruleId: rule.id, startedAt: now, completedAt: now,
        status, output, triggeredBy: 'threshold',
      })
      saveRule({ ...rule, lastRunAt: now, lastRunStatus: status, lastRunOutput: output, runCount: rule.runCount + 1 })
    }
  }

  // ── 2. Anomaly detection → autonomous proposals ───────────────────────────

  const existing = loadProposals()

  function pendingExists(dbId: string, actionType: string): boolean {
    return existing.some(p => p.dbId === dbId && p.actionType === actionType && p.status === 'pending')
  }

  function addProposal(p: AutonomousProposal) {
    saveProposal(p)
    existing.push(p) // keep in-memory list consistent for duplicate check within same run
    proposalsGenerated++
  }

  // ── Table bloat (PostgreSQL) ─────────────────────────────────────────────
  for (const cap of capacity) {
    const db = dbs.find(d => d.id === cap.dbId)
    if (!db || db.engine !== 'postgresql') continue

    if (cap.tableBloatPct >= 20 && !pendingExists(cap.dbId, 'vacuum')) {
      addProposal({
        id: newProposalId(), source: 'performance',
        severity: cap.tableBloatPct >= 35 ? 'high' : 'medium',
        title: `VACUUM required — ${cap.dbName} table bloat at ${cap.tableBloatPct}%`,
        description: `Table dead-tuple ratio is ${cap.tableBloatPct}%. This degrades index scans and wastes disk space. Auto-detected by capacity monitor.`,
        dbId: cap.dbId, dbName: cap.dbName, engine: db.engine,
        actionType: 'vacuum', risk: 'low',
        proposedAction: 'VACUUM (VERBOSE, ANALYZE);',
        sql: 'VACUUM (VERBOSE, ANALYZE);\n-- Reclaims dead tuples, refreshes statistics',
        confidence: 97, estimatedGain: `~${cap.tableBloatPct}% bloat removed, faster index scans`,
        status: 'pending', autoExecuteEnabled: cap.tableBloatPct < 35,
        createdAt: new Date().toISOString(),
      })
    }

    if (cap.indexBloatPct >= 25 && !pendingExists(cap.dbId, 'reindex')) {
      addProposal({
        id: newProposalId(), source: 'performance', severity: 'medium',
        title: `REINDEX recommended — ${cap.dbName} index bloat at ${cap.indexBloatPct}%`,
        description: `Index fragmentation is at ${cap.indexBloatPct}%. Fragmented indexes slow down range scans and ORDER BY queries.`,
        dbId: cap.dbId, dbName: cap.dbName, engine: db.engine,
        actionType: 'reindex', risk: 'low',
        proposedAction: 'REINDEX DATABASE CONCURRENTLY labdb;',
        sql: 'REINDEX DATABASE CONCURRENTLY labdb;\n-- Online rebuild, no table lock required',
        confidence: 88, estimatedGain: 'Reduced storage, faster index scans',
        status: 'pending', autoExecuteEnabled: false,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // ── Connection pool pressure ─────────────────────────────────────────────
  for (const [dbId, snap] of snapshots.entries()) {
    const db = dbs.find(d => d.id === dbId)
    if (!db || snap.maxConnections === 0) continue

    const connPct = Math.round(100 * snap.activeConnections / snap.maxConnections)

    if (connPct >= settings.connectionPoolPctAlert && !pendingExists(dbId, 'kill_query')) {
      const estimatedIdle = Math.round(snap.activeConnections * 0.25)
      const sql = db.engine === 'postgresql'
        ? `SELECT pg_terminate_backend(pid)\nFROM pg_stat_activity\nWHERE state = 'idle'\n  AND state_change < NOW() - INTERVAL '30 minutes';`
        : `SELECT CONCAT('KILL ', id, ';')\nFROM information_schema.processlist\nWHERE command = 'Sleep' AND time > 1800;`

      addProposal({
        id: newProposalId(), source: 'performance',
        severity: connPct >= Math.min(100, settings.connectionPoolPctAlert + 10) ? 'critical' : 'high',
        title: `Connection pool at ${connPct}% on ${db.name} — kill idle connections`,
        description: `${snap.activeConnections}/${snap.maxConnections} connections in use. ~${estimatedIdle} estimated idle >30 min. New connections will queue.`,
        dbId, dbName: db.name, engine: db.engine,
        actionType: 'kill_query', risk: 'low',
        proposedAction: `Kill idle connections (>${connPct >= Math.min(100, settings.connectionPoolPctAlert + 10) ? '10' : '30'} min)`,
        sql, confidence: 93, estimatedGain: `Free ~${estimatedIdle} connection slots`,
        status: 'pending', autoExecuteEnabled: connPct >= Math.min(100, settings.connectionPoolPctAlert + 10) && connPct < 95,
        createdAt: new Date().toISOString(),
      })
    }

    // ── Redis high memory ──────────────────────────────────────────────────
    if (db.engine === 'redis' && snap.memPct >= 75 && !pendingExists(dbId, 'config_change')) {
      addProposal({
        id: newProposalId(), source: 'performance',
        severity: snap.memPct >= 90 ? 'critical' : 'medium',
        title: `Redis memory at ${snap.memPct}% on ${db.name}`,
        description: `Redis used ${snap.memPct}% of maxmemory. With noeviction policy, write errors will occur when full.`,
        dbId, dbName: db.name, engine: 'redis',
        actionType: 'config_change', risk: 'medium',
        proposedAction: 'Set maxmemory-policy allkeys-lru',
        sql: 'CONFIG SET maxmemory-policy allkeys-lru\nCONFIG REWRITE\n-- Verify: CONFIG GET maxmemory-policy',
        confidence: 87, estimatedGain: 'Prevent OOM write errors, automatic key eviction',
        status: 'pending', autoExecuteEnabled: false,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // ── Replication lag ──────────────────────────────────────────────────────
  for (const repl of replication) {
    if (repl.role !== 'replica') continue
    const db = dbs.find(d => d.id === repl.dbId)
    if (!db) continue

    if (repl.lagSeconds > settings.replicationLagAlertSec && !pendingExists(repl.dbId, 'custom')) {
      addProposal({
        id: newProposalId(), source: 'performance',
        severity: repl.lagSeconds >= settings.replicationLagAlertSec * 2 ? 'critical' : 'high',
        title: `Replication lag ${repl.lagSeconds.toFixed(1)}s on ${repl.dbName}`,
        description: `Streaming replication lag is ${repl.lagSeconds.toFixed(1)}s. Replica is falling behind — data divergence risk on failover.`,
        dbId: repl.dbId, dbName: repl.dbName, engine: repl.engine,
        actionType: 'custom', risk: 'high',
        proposedAction: 'Investigate WAL sender/receiver, check network and disk I/O',
        sql: `-- On primary: inspect WAL senders\nSELECT client_addr, state, sent_lsn, replay_lsn,\n       (sent_lsn - replay_lsn) AS lag_bytes\nFROM pg_stat_replication;\n\n-- On replica: inspect WAL receiver\nSELECT status, last_msg_send_time, last_msg_receipt_time\nFROM pg_stat_wal_receiver;`,
        confidence: 95, estimatedGain: 'Reduce failover data loss risk to near-zero',
        status: 'pending', autoExecuteEnabled: false,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // ── Slow query cluster (unanalyzed, frequent) ────────────────────────────
  const slowByDb = new Map<string, SlowQuery[]>()
  for (const q of slowQueries) {
    if (!slowByDb.has(q.dbId)) slowByDb.set(q.dbId, [])
    slowByDb.get(q.dbId)!.push(q)
  }

  for (const [dbId, queries] of slowByDb.entries()) {
    const db = dbs.find(d => d.id === dbId)
    if (!db) continue
    const unanalyzed = queries.filter(q => !q.analyzed && q.durationMs >= settings.slowQueryThresholdMs)

    if (unanalyzed.length >= 3 && !pendingExists(dbId, 'analyze')) {
      const worst = [...unanalyzed].sort((a, b) => b.durationMs - a.durationMs)[0]
      const table = worst.query.match(/FROM\s+([a-zA-Z_][a-zA-Z0-9_.]*)/i)?.[1]
      // A proposal without a specific table cannot pass the maintenance policy; keep it advisory rather than falsely actionable.
      const sql = table
        ? (db.engine === 'postgresql' ? `ANALYZE ${table.includes('.') ? table : `public.${table}`};` : `ANALYZE TABLE ${table.split('.').pop()};`)
        : (db.engine === 'postgresql' ? 'ANALYZE;\n-- No specific table identified; manual review required' : 'ANALYZE TABLE table_name;\n-- No specific table identified; manual review required')
      addProposal({
        id: newProposalId(), source: 'slow_query',
        severity: unanalyzed.length >= 5 ? 'high' : 'medium',
        title: `${unanalyzed.length} slow queries >=${settings.slowQueryThresholdMs}ms on ${db.name} — run ANALYZE${table ? ` on ${table}` : ''}`,
        description: `${unanalyzed.length} queries exceed ${settings.slowQueryThresholdMs}ms avg. Worst: ${worst.durationMs}ms. Stale statistics may cause poor plan choices.`,
        dbId, dbName: db.name, engine: db.engine,
        actionType: 'analyze', risk: 'low',
        proposedAction: table ? `ANALYZE ${table}; (refresh statistics for this table)` : 'Identify the affected table and refresh its statistics manually',
        sql,
        confidence: 82, estimatedGain: '2-10x speedup on affected queries via better plan selection',
        status: 'pending', autoExecuteEnabled: false,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // ── Security findings → proposals ────────────────────────────────────────
  const secFindings = loadJson<Array<{ dbId: string; dbName: string; severity: string; title: string; recommendation: string; status: string }>>(
    'security.json', []
  )
  const criticalSec = secFindings.filter(f => f.severity === 'critical' && f.status === 'open')
  for (const finding of criticalSec.slice(0, 3)) {
    const db = dbs.find(d => d.id === finding.dbId)
    if (!db || pendingExists(finding.dbId, 'custom')) continue
    addProposal({
      id: newProposalId(), source: 'security', severity: 'critical',
      title: `Security: ${finding.title}`,
      description: `Critical security finding detected on ${finding.dbName}. ${finding.recommendation}`,
      dbId: finding.dbId, dbName: finding.dbName, engine: db.engine,
      actionType: 'custom', risk: 'high',
      proposedAction: finding.recommendation,
      confidence: 90, estimatedGain: 'Mitigates critical security vulnerability',
      status: 'pending', autoExecuteEnabled: false,
      createdAt: new Date().toISOString(),
    })
  }

  // ── 3. Auto-raise critical incidents ─────────────────────────────────────

  const openIncidents = loadIncidents().filter(i => i.status !== 'resolved')

  function incidentOpen(dbId: string, keyword: string): boolean {
    return openIncidents.some(i => i.dbId === dbId && i.title.startsWith(keyword))
  }

  // DB unreachable
  for (const db of dbs) {
    if (db.status === 'error' && !isStatusStale(db.lastChecked) && !incidentOpen(db.id, `DB unreachable: ${db.name}`)) {
      addIncident({
        dbId: db.id, dbName: db.name, source: 'auto',
        title: `DB unreachable: ${db.name}`,
        severity: 'critical', category: 'availability', status: 'open',
        notes: `Auto-raised by monitor. Last checked: ${db.lastChecked}`,
      })
      incidentsRaised++
    }
  }

  // Critical replication lag uses the configured alert threshold.
  for (const repl of replication) {
    if (repl.role !== 'replica' || repl.lagSeconds < settings.replicationLagAlertSec * 2) continue
    if (!incidentOpen(repl.dbId, `Replication lag critical: ${repl.dbName}`)) {
      addIncident({
        dbId: repl.dbId, dbName: repl.dbName, source: 'auto',
        title: `Replication lag critical: ${repl.dbName} (${repl.lagSeconds.toFixed(0)}s)`,
        severity: 'critical', category: 'replication', status: 'open',
        notes: `Auto-raised. Lag: ${repl.lagSeconds.toFixed(0)}s. Risk of data loss on failover.`,
      })
      incidentsRaised++
    }
  }

  // Connection pool critical uses the configured threshold plus a 10-point escalation band.
  for (const [dbId, snap] of snapshots.entries()) {
    const db = dbs.find(d => d.id === dbId)
    if (!db || snap.maxConnections === 0) continue
    const connPct = Math.round(100 * snap.activeConnections / snap.maxConnections)
    const criticalPoolPct = Math.min(100, settings.connectionPoolPctAlert + 10)
    if (connPct >= criticalPoolPct && !incidentOpen(dbId, `Connection pool critical: ${db.name}`)) {
      addIncident({
        dbId, dbName: db.name, source: 'auto',
        title: `Connection pool critical: ${db.name} (${connPct}%)`,
        severity: 'critical', category: 'performance', status: 'open',
        notes: `Auto-raised. Pool: ${snap.activeConnections}/${snap.maxConnections} (${connPct}%). Configured alert: ${settings.connectionPoolPctAlert}%.`,
      })
      incidentsRaised++
    }
  }

  // High disk usage (≥90%) — only for engines with real filesystem free space data
  // freeSizeMB < 100 means it's internal overhead (PG/MySQL), not real disk free — skip those
  for (const cap of capacity) {
    const db = dbs.find(d => d.id === cap.dbId)
    if (!db || cap.totalSizeMB === 0 || cap.freeSizeMB < 100) continue
    const diskTotalMB = cap.totalSizeMB + cap.freeSizeMB
    const diskPct = Math.round(100 * cap.totalSizeMB / diskTotalMB)
    if (diskPct >= 90 && !incidentOpen(cap.dbId, `Disk critical: ${cap.dbName}`)) {
      addIncident({
        dbId: cap.dbId, dbName: cap.dbName, source: 'auto',
        title: `Disk critical: ${cap.dbName} at ${diskPct}%`,
        severity: 'high', category: 'capacity', status: 'open',
        notes: `Auto-raised. DB size ${cap.totalSizeMB} MB, disk free ${cap.freeSizeMB} MB (${diskPct}% used).`,
      })
      incidentsRaised++
    }
  }

  // Backup RPO breach
  const backups = loadJson<Array<{ dbId: string; status: string; completedAt?: string; startedAt?: string; scheduledAt: string }>>('backups.json', [])
  for (const db of dbs) {
    const latest = backups
      .filter(b => b.dbId === db.id && b.status === 'succeeded')
      .sort((a, b) => (b.completedAt ?? b.startedAt ?? b.scheduledAt).localeCompare(a.completedAt ?? a.startedAt ?? a.scheduledAt))[0]
    const latestAt = latest?.completedAt ?? latest?.startedAt ?? latest?.scheduledAt
    const ageHours = latestAt ? (Date.now() - new Date(latestAt).getTime()) / 3_600_000 : Number.POSITIVE_INFINITY
    if (ageHours > settings.backupRpoBreachAlertHrs && !incidentOpen(db.id, `Backup RPO breach: ${db.name}`)) {
      addIncident({
        dbId: db.id, dbName: db.name, source: 'auto',
        title: `Backup RPO breach: ${db.name}`,
        severity: 'high', category: 'backup', status: 'open',
        notes: `No successful backup within ${settings.backupRpoBreachAlertHrs} hours. Last successful backup: ${latestAt ?? 'never'}.`,
      })
      incidentsRaised++
    }
  }

  // Persist SLA breach state and deliver delayed escalation steps once per incident/step.
  const sla = loadSla()
  const escalationState = loadJson<Record<string, string>>('escalation-state.json', {})
  const escalationPolicies = loadEscalations()
  for (const incident of loadIncidents()) {
    for (const event of incident.notificationEvents ?? []) {
      await notifyIncident({ ...incident, status: event.status, reopenedAt: event.reopenedAt }, matchRouting(incident.severity, incident.category), event.key)
    }
  }
  for (const incident of loadIncidents().filter(item => item.status !== 'resolved')) {
    const target = sla[incident.severity] ?? { ackMinutes: 30, resolveMinutes: 240 }
    const ageMinutes = (Date.now() - new Date(incident.reopenedAt ?? incident.createdAt).getTime()) / 60_000
    const ackBreached = !incident.acknowledgedAt && ageMinutes > target.ackMinutes
    const resolveBreached = incident.status !== 'resolved' && ageMinutes > target.resolveMinutes
    if ((ackBreached || resolveBreached) && !incident.slaBreach) patchIncident(incident.id, { slaBreach: true })

    const route = matchRouting(incident.severity, incident.category)
    await notifyIncident(incident, route)
    const policy = escalationPolicies.find(item => item.id === (route?.escalationPolicyId ?? 'default'))
    if (!policy) continue
    for (let stepIndex = 0; stepIndex < policy.steps.length; stepIndex++) {
      const step = policy.steps[stepIndex]
      const condition = step.condition ?? (step.delayMin <= target.ackMinutes ? 'unacknowledged' : 'unresolved')
      if (step.delayMin < 0 || ageMinutes < step.delayMin || (incident.acknowledgedAt && condition === 'unacknowledged')) continue
      const stateKey = `${incident.id}:${policy.id}:${stepIndex}${incident.reopenedAt ? `:${incident.reopenedAt}` : ''}`
      if (escalationState[stateKey]) continue
      const message = step.message ?? `Escalation: ${incident.title} remains ${incident.status}`
      const delivered = await notifyIncident(incident, { ...step, notifyTeams: !!step.notifyTeams, notifyWebhook: !!step.notifyWebhook }, `escalation:${policy.id}:${stepIndex}`, `[VynDB ESCALATION] ${message}\nIncident: ${incident.id}\nTitle: ${incident.title}\nDatabase: ${incident.dbName}`)
      if (delivered) {
        escalationState[stateKey] = new Date().toISOString()
        saveJson('escalation-state.json', escalationState)
      }
      appendAudit({ actor: 'monitor', action: 'incident.escalate', resource: 'incident', resourceId: incident.id, success: delivered, details: { policy: policy.id, step: stepIndex } })
    }
  }
  saveJson('escalation-state.json', escalationState)

  return {
    durationMs: Date.now() - t0,
    rulesEvaluated: thresholdRules.length,
    thresholdBreaches,
    proposalsGenerated,
    incidentsRaised,
  }
}
