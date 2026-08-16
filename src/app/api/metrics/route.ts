import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { loadCapacity, loadDatabases, loadReplication, loadSecurity, loadSlowQueries } from '@/lib/db-store'

const TOKEN = process.env.VYNDB_METRICS_TOKEN ?? process.env.VYNDB_COLLECTOR_TOKEN ?? 'vyndb_collector_token_lab_2024'

function label(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function metric(name: string, labels: Record<string, string>, value: number): string {
  const rendered = Object.entries(labels).map(([key, item]) => `${key}="${label(item)}"`).join(',')
  return `${name}{${rendered}} ${Number.isFinite(value) ? value : 0}`
}

function loadSnapshots(): Array<Record<string, unknown>> {
  const file = path.join(process.cwd(), 'data', 'perf-snapshots.json')
  if (!fs.existsSync(file)) return []
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, unknown>> } catch { return [] }
}

export async function GET(req: NextRequest) {
  const provided = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!provided || provided !== TOKEN) return new NextResponse('Unauthorized\n', { status: 401 })

  const dbs = loadDatabases()
  const snapshots = loadSnapshots()
  const latest = new Map<string, Record<string, unknown>>()
  for (const snapshot of snapshots) {
    const current = latest.get(String(snapshot.dbId))
    if (!current || String(snapshot.timestamp) > String(current.timestamp)) latest.set(String(snapshot.dbId), snapshot)
  }
  const slowQueries = loadSlowQueries()
  const replication = loadReplication()
  const capacity = loadCapacity()
  const security = loadSecurity()
  const lines = [
    '# HELP vyndb_database_health_score Current VynDB database health score.',
    '# TYPE vyndb_database_health_score gauge',
    ...dbs.map(db => metric('vyndb_database_health_score', { db_id: db.id, engine: db.engine, database: db.name }, db.healthScore)),
    '# HELP vyndb_database_active_connections Current active database connections.',
    '# TYPE vyndb_database_active_connections gauge',
    ...dbs.flatMap(db => { const snapshot = latest.get(db.id); return snapshot ? [metric('vyndb_database_active_connections', { db_id: db.id, engine: db.engine }, Number(snapshot.activeConnections))] : [] }),
    '# HELP vyndb_database_max_connections Configured maximum database connections.',
    '# TYPE vyndb_database_max_connections gauge',
    ...dbs.flatMap(db => { const snapshot = latest.get(db.id); return snapshot ? [metric('vyndb_database_max_connections', { db_id: db.id, engine: db.engine }, Number(snapshot.maxConnections))] : [] }),
    '# HELP vyndb_database_tps Database transactions or operations per second.',
    '# TYPE vyndb_database_tps gauge',
    ...dbs.flatMap(db => { const snapshot = latest.get(db.id); return snapshot ? [metric('vyndb_database_tps', { db_id: db.id, engine: db.engine }, Number(snapshot.tps))] : [] }),
    '# HELP vyndb_database_latency_p95_ms Estimated or collected p95 latency in milliseconds.',
    '# TYPE vyndb_database_latency_p95_ms gauge',
    ...dbs.flatMap(db => { const snapshot = latest.get(db.id); return snapshot ? [metric('vyndb_database_latency_p95_ms', { db_id: db.id, engine: db.engine }, Number(snapshot.latencyP95Ms))] : [] }),
    '# HELP vyndb_slow_queries_total Stored slow-query records by database.',
    '# TYPE vyndb_slow_queries_total gauge',
    ...dbs.map(db => metric('vyndb_slow_queries_total', { db_id: db.id, engine: db.engine }, slowQueries.filter(query => query.dbId === db.id).length)),
    '# HELP vyndb_replication_lag_seconds Current replica lag.',
    '# TYPE vyndb_replication_lag_seconds gauge',
    ...replication.map(item => metric('vyndb_replication_lag_seconds', { db_id: item.dbId, engine: item.engine }, item.lagSeconds)),
    '# HELP vyndb_security_findings_open Open security findings by database.',
    '# TYPE vyndb_security_findings_open gauge',
    ...dbs.map(db => metric('vyndb_security_findings_open', { db_id: db.id, engine: db.engine }, security.filter(finding => finding.dbId === db.id && finding.status === 'open').length)),
    '# HELP vyndb_capacity_size_mb Current database capacity size.',
    '# TYPE vyndb_capacity_size_mb gauge',
    ...capacity.map(item => metric('vyndb_capacity_size_mb', { db_id: item.dbId }, item.totalSizeMB)),
  ]
  return new NextResponse(`${lines.join('\n')}\n`, { headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' } })
}