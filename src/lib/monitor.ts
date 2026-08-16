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
import { loadIncidents, addIncident, patchIncident, loadEscalations, currentOnCallEmails } from './incident-store'
import { sendSlack, sendTeams, sendWebhook, sendEmail } from './notifier'
import { getSettings } from './settings-store'
import { matchRouting } from './incident-store'
import { appendAudit } from './audit-store'

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
      const cutoff = new Date(Date.now() - 10 * 60000).toISOString()
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
  const snapshots = latestSnapshots()
  const capacity = loadCapacity()
  const replication = loadReplication()
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
      const value = metricValue(metric, db.id, snapshots, capacity, replication, slowQueries)
      if (!evalOp(value, op, threshold)) continue

      thresholdBreaches++
      const now = new Date().toISOString()
      const output = `Threshold breach on ${db.name}: ${metric} = ${value.toFixed(1)} ${op} ${threshold}`
      const msgTemplate = rule.actions.find(a => a.type === 'slack_notify' || a.type === 'email_notify')?.message ?? rule.name

      const msg = msgTemplate
        .replace('{{count}}', String(Math.round(value)))
        .replace('{{metric}}', metric)
        .replace('{{value}}', value.toFixed(1))
        .replace('{{db}}', db.name)

      // Execute all actions for this rule
      for (const action of rule.actions) {
        if (action.type === 'slack_notify' || action.type === 'email_notify') {
          await dispatch(msg, `[VynDB Alert] ${rule.name}`).catch(() => {})
        }
        // kill_idle, vacuum, analyze, reindex, custom_sql are execution actions
        // These are recorded as "pending execution" via the run log
      }

      // Log the run
      addRun({
        id: `run-${crypto.randomUUID().slice(0, 8)}`,
        ruleId: rule.id, startedAt: now, completedAt: now,
        status: 'success', output, triggeredBy: 'threshold',
      })
      saveRule({ ...rule, lastRunAt: now, lastRunStatus: 'success', lastRunOutput: output, runCount: rule.runCount + 1 })
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
      addProposal({
        id: newProposalId(), source: 'slow_query',
        severity: unanalyzed.length >= 5 ? 'high' : 'medium',
        title: `${unanalyzed.length} slow queries >=${settings.slowQueryThresholdMs}ms on ${db.name} — run ANALYZE`,
        description: `${unanalyzed.length} queries exceed ${settings.slowQueryThresholdMs}ms avg. Worst: ${worst.durationMs}ms. Stale statistics may cause poor plan choices.`,
        dbId, dbName: db.name, engine: db.engine,
        actionType: 'analyze', risk: 'low',
        proposedAction: 'ANALYZE; (refresh statistics for all tables)',
        sql: db.engine === 'postgresql'
          ? 'ANALYZE;\n-- Updates planner statistics for all tables'
          : `ANALYZE TABLE ${worst.query.match(/FROM\s+(\w+)/i)?.[1] ?? 'table_name'};`,
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

  function incidentOpen(keyword: string): boolean {
    return openIncidents.some(i => i.title.includes(keyword))
  }

  // DB unreachable
  for (const db of dbs) {
    if (db.status === 'error' && !incidentOpen(db.name)) {
      addIncident({
        dbId: db.id, dbName: db.name, source: 'auto',
        title: `DB unreachable: ${db.name}`,
        severity: 'critical', category: 'availability', status: 'open',
        notes: `Auto-raised by monitor. Last checked: ${db.lastChecked}`,
      })
      incidentsRaised++
      await dispatch(
        `🔴 *CRITICAL* — DB unreachable: *${db.name}* (${db.engine})\nLast seen: ${db.lastChecked}`,
        `[VynDB CRITICAL] DB unreachable: ${db.name}`
      ).catch(() => {})
    }
  }

  // Critical replication lag uses the configured alert threshold.
  for (const repl of replication) {
    if (repl.role !== 'replica' || repl.lagSeconds < settings.replicationLagAlertSec * 2) continue
    if (!incidentOpen(`Replication lag critical: ${repl.dbName}`)) {
      addIncident({
        dbId: repl.dbId, dbName: repl.dbName, source: 'auto',
        title: `Replication lag critical: ${repl.dbName} (${repl.lagSeconds.toFixed(0)}s)`,
        severity: 'critical', category: 'replication', status: 'open',
        notes: `Auto-raised. Lag: ${repl.lagSeconds.toFixed(0)}s. Risk of data loss on failover.`,
      })
      incidentsRaised++
      await dispatch(
        `⚠️ *Replication lag critical* on ${repl.dbName}: ${repl.lagSeconds.toFixed(0)}s behind primary`,
        `[VynDB] Replication lag critical: ${repl.dbName}`
      ).catch(() => {})
    }
  }

  // Connection pool critical uses the configured threshold plus a 10-point escalation band.
  for (const [dbId, snap] of snapshots.entries()) {
    const db = dbs.find(d => d.id === dbId)
    if (!db || snap.maxConnections === 0) continue
    const connPct = Math.round(100 * snap.activeConnections / snap.maxConnections)
    const criticalPoolPct = Math.min(100, settings.connectionPoolPctAlert + 10)
    if (connPct >= criticalPoolPct && !incidentOpen(`Connection pool critical: ${db.name}`)) {
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
    if (diskPct >= 90 && !incidentOpen(`Disk critical: ${cap.dbName}`)) {
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
    if (ageHours > settings.backupRpoBreachAlertHrs && !incidentOpen(`Backup RPO breach: ${db.name}`)) {
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
  const sla = loadJson<Record<string, { ackMinutes: number; resolveMinutes: number }>>('sla.json', {})
  const escalationState = loadJson<Record<string, string>>('escalation-state.json', {})
  const escalationPolicies = loadEscalations()
  for (const incident of loadIncidents().filter(item => item.status !== 'resolved')) {
    const target = sla[incident.severity] ?? { ackMinutes: 30, resolveMinutes: 240 }
    const ageMinutes = (Date.now() - new Date(incident.createdAt).getTime()) / 60_000
    const ackBreached = !incident.acknowledgedAt && ageMinutes > target.ackMinutes
    const resolveBreached = incident.status !== 'resolved' && ageMinutes > target.resolveMinutes
    if (ackBreached || resolveBreached) patchIncident(incident.id, { slaBreach: true })

    const route = matchRouting(incident.severity, incident.category)
    const policy = escalationPolicies.find(item => item.id === (route?.escalationPolicyId ?? 'default'))
    if (!policy) continue
    for (let stepIndex = 0; stepIndex < policy.steps.length; stepIndex++) {
      const step = policy.steps[stepIndex]
      if (step.delayMin <= 0 || ageMinutes < step.delayMin || (incident.acknowledgedAt && step.delayMin <= target.ackMinutes)) continue
      const stateKey = `${incident.id}:${policy.id}:${stepIndex}`
      if (escalationState[stateKey]) continue
      const message = step.message ?? `Escalation: ${incident.title} remains ${incident.status}`
      if (step.notifySlack) await sendSlack(`[VynDB ESCALATION] ${message}\nIncident: ${incident.title}\nDatabase: ${incident.dbName}`).catch(() => {})
      if (step.notifyTeams) await sendTeams(`[VynDB ESCALATION] ${message}\nIncident: ${incident.title}\nDatabase: ${incident.dbName}`).catch(() => {})
      if (step.notifyWebhook) await sendWebhook({ alert_type: 'escalation', incidentId: incident.id, title: incident.title, database: incident.dbName, message, step: stepIndex }).catch(() => {})
      if (step.notifyOncall) {
        const emails = currentOnCallEmails()
        if (emails.length) await sendEmail(emails, `[VynDB ESCALATION] ${incident.title}`, message).catch(() => {})
      }
      if (step.notifyEmails.length) await sendEmail(step.notifyEmails, `[VynDB ESCALATION] ${incident.title}`, message).catch(() => {})
      escalationState[stateKey] = new Date().toISOString()
      appendAudit({ actor: 'monitor', action: 'incident.escalate', resource: 'incident', resourceId: incident.id, success: true, details: { policy: policy.id, step: stepIndex } })
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
