import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases, loadSlowQueries, loadCapacity, loadReplication, loadBackups, loadSchema } from '@/lib/db-store'
import { getSettings } from '@/lib/settings-store'
import { recordUsage } from '@/lib/copilot-usage'
import { loadIncidents, loadOncall, loadRouting, loadSla } from '@/lib/incident-store'
import { loadRules, loadProposals } from '@/lib/automation-store'
import Groq from 'groq-sdk'
import fs from 'fs'
import path from 'path'
import type { PerformanceSnapshot, SecurityFinding } from '@/lib/db-store'

function loadLatestSnapshots(): Map<string, PerformanceSnapshot> {
  const p = path.join(process.cwd(), 'data', 'perf-snapshots.json')
  if (!fs.existsSync(p)) return new Map()
  try {
    const snaps: PerformanceSnapshot[] = JSON.parse(fs.readFileSync(p, 'utf8'))
    const latest = new Map<string, PerformanceSnapshot>()
    for (const s of snaps) {
      const ex = latest.get(s.dbId)
      if (!ex || s.timestamp > ex.timestamp) latest.set(s.dbId, s)
    }
    return latest
  } catch { return new Map() }
}

function loadSecurityFindings(): SecurityFinding[] {
  const p = path.join(process.cwd(), 'data', 'security.json')
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return [] }
}

function buildRichContext(): string {
  const dbs       = loadDatabases()
  const snaps     = loadLatestSnapshots()
  const slowQs    = loadSlowQueries().filter(q => q.durationMs > 100).sort((a,b) => b.durationMs - a.durationMs).slice(0, 8)
  const cap       = loadCapacity()
  const repl      = loadReplication()
  const sec       = loadSecurityFindings().filter(f => f.status === 'open')
  const incs      = loadIncidents().filter(i => i.status !== 'resolved').slice(0, 5)
  const backups   = loadBackups()
  const schema    = loadSchema()
  const oncall    = loadOncall()
  const sla       = loadSla()
  const routing   = loadRouting()
  const rules     = loadRules().filter(r => r.enabled).slice(0, 10)
  const proposals = loadProposals().filter(p => p.status === 'pending').slice(0, 5)
  const settings  = getSettings()

  // Last successful backup per DB
  const lastBackup = new Map<string, { completedAt: string; sizeMB: number; type: string }>()
  for (const b of backups) {
    if (b.status === 'succeeded' && b.completedAt) {
      const ex = lastBackup.get(b.dbId)
      if (!ex || b.completedAt > ex.completedAt) lastBackup.set(b.dbId, { completedAt: b.completedAt, sizeMB: b.sizeMB, type: b.type })
    }
  }

  const lines: string[] = ['=== LIVE DATABASE METRICS ===']

  for (const db of dbs) {
    const snap = snaps.get(db.id)
    const capacity = cap.find(c => c.dbId === db.id)
    const replication = repl.find(r => r.dbId === db.id)
    const bk = lastBackup.get(db.id)
    const tables = schema.filter(s => s.dbId === db.id)

    lines.push(`\n[${db.name}] ${db.engine} ${db.version ?? ''} | env:${db.environment} | status:${db.status} | health:${db.healthScore}/100`)
    if (db.notes) lines.push(`  notes: ${db.notes}`)
    if (snap) {
      lines.push(`  perf: tps=${snap.tps} lat_p50=${snap.latencyP50Ms}ms lat_p95=${snap.latencyP95Ms}ms lat_p99=${snap.latencyP99Ms}ms`)
      lines.push(`  connections: ${snap.activeConnections}/${snap.maxConnections} (${Math.round(snap.activeConnections/snap.maxConnections*100)}%) | cache_hit:${snap.cacheHitRatio}%`)
    }
    if (capacity) {
      lines.push(`  size: total=${Math.round(capacity.totalSizeMB)}MB data=${capacity.dataSizeMB}MB idx=${capacity.indexSizeMB}MB free=${capacity.freeSizeMB}MB`)
      lines.push(`  growth:${capacity.growthMBPerDay}MB/d | idx_bloat:${capacity.indexBloatPct}% tbl_bloat:${capacity.tableBloatPct}%`)
      if (capacity.topTables.length) lines.push(`  top tables by size: ${capacity.topTables.slice(0,5).map(t=>`${t.name}(${t.sizeMB}MB)`).join(', ')}`)
    }
    if (tables.length) {
      lines.push(`  schema: ${tables.length} tables | ${tables.slice(0,6).map(t=>`${t.name}(${t.rowCount.toLocaleString()} rows, ${t.columns.length} cols, ${t.indexes.length} idx)`).join(', ')}`)
    }
    if (replication) lines.push(`  replication: role=${replication.role} lag=${replication.lagSeconds}s state=${replication.syncState??'n/a'} replicas=${replication.connectedReplicas??0} status=${replication.status}`)
    if (bk) {
      const ageH = Math.round((Date.now() - new Date(bk.completedAt).getTime()) / 3600000)
      lines.push(`  last backup: ${bk.type} ${ageH}h ago | size:${bk.sizeMB}MB | at:${bk.completedAt}`)
    } else {
      lines.push(`  last backup: none recorded`)
    }
  }

  if (slowQs.length) {
    lines.push('\n=== TOP SLOW QUERIES ===')
    for (const q of slowQs) lines.push(`[${q.dbName}] ${q.durationMs}ms: ${q.query.substring(0,120).replace(/\s+/g,' ')}`)
  }

  if (sec.length) {
    lines.push('\n=== OPEN SECURITY FINDINGS ===')
    for (const f of sec) lines.push(`[${f.dbName}] ${f.severity}/${f.category}: ${f.title} | fix: ${f.recommendation.substring(0,80)}`)
  }

  if (incs.length) {
    lines.push('\n=== ACTIVE INCIDENTS ===')
    for (const i of incs) lines.push(`[${i.dbName}] ${i.severity} ${i.status}: ${i.title} | since:${i.createdAt}`)
  }

  if (proposals.length) {
    lines.push('\n=== PENDING AUTONOMOUS PROPOSALS ===')
    for (const p of proposals) lines.push(`[${p.dbName}] ${p.severity} risk:${p.risk} conf:${p.confidence}% | ${p.title}: ${p.proposedAction.substring(0,100)}`)
  }

  if (rules.length) {
    lines.push('\n=== ACTIVE AUTOMATION RULES ===')
    for (const r of rules) {
      const triggerDesc = r.trigger === 'threshold' && r.thresholdMetric
        ? `${r.thresholdMetric}${r.thresholdOperator}${r.thresholdValue}`
        : r.trigger === 'cron' ? `cron(${r.cronLabel ?? r.cronExpr ?? ''})` : r.trigger
      lines.push(`${r.name}: trigger=${triggerDesc} actions=${r.actions.map(a => a.type).join(',')}`)
    }
  }

  const oncallNow = oncall.find(s => new Date(s.startTime) <= new Date() && new Date(s.endTime) > new Date())
  if (oncallNow) lines.push(`\n=== ON-CALL NOW ===\n${oncallNow.userName} <${oncallNow.userEmail}> until ${oncallNow.endTime}`)

  lines.push('\n=== SLA TARGETS ===')
  for (const [sev, tier] of Object.entries(sla)) {
    const t = tier as { ackMinutes: number; resolveMinutes: number }
    lines.push(`${sev}: ack<${t.ackMinutes}min resolve<${Math.round(t.resolveMinutes/60)}h`)
  }

  lines.push('\n=== ALERT ROUTING ===')
  for (const r of routing.slice(0,6)) lines.push(`${r.name}: sev=${r.severity} cat=${r.category} → ${[r.notifySlack?'slack':'', r.notifyOncall?'oncall':'', ...r.notifyEmails].filter(Boolean).join(',')||'no notification'}`)

  lines.push('\n=== SYSTEM CONFIG ===')
  lines.push(`slow_query_threshold:${settings.slowQueryThresholdMs}ms | replication_lag_alert:${settings.replicationLagAlertSec}s | conn_pool_alert:${settings.connectionPoolPctAlert}% | backup_rpo_alert:${settings.backupRpoBreachAlertHrs}h`)

  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth

  const { messages, dbContext } = await req.json() as {
    messages: { role: 'user' | 'assistant'; content: string }[]
    dbContext?: string
  }

  const settings = getSettings()
  const apiKey = settings.groqApiKey || process.env.GROQ_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Groq API key not configured. Set it in Settings → AI Copilot.' }, { status: 400 })
  }

  const dbs = loadDatabases()
  const dbList = dbs.map(d => `- ${d.name} (${d.engine}, ${d.environment})`).join('\n')
  const richContext = buildRichContext()

  const systemPrompt = `You are VynDB AI Copilot, an expert database operations assistant. You help DBAs and developers with query optimization, performance troubleshooting, replication, schema design, backups, security, and capacity planning.

Managed databases:
${dbList}
${dbContext ? `\nUser-reported status: ${dbContext}` : ''}

${richContext}

Instructions: Answer using the real metrics above when relevant. Be concise and practical. Use code blocks for SQL/commands. Cite specific values (latency, query text, table sizes) from the context when answering.`

  const groq = new Groq({ apiKey })

  try {
    const completion = await groq.chat.completions.create({
      model: settings.aiModel || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.5,
      max_tokens: 2048,
    })
    const reply = completion.choices[0]?.message?.content ?? ''
    recordUsage(completion.usage?.prompt_tokens ?? 0, completion.usage?.completion_tokens ?? 0, settings.aiModel || 'llama-3.3-70b-versatile')
    return NextResponse.json({ content: reply })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
