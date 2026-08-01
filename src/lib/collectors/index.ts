import fs from 'fs'
import path from 'path'
import { loadDatabases } from '../db-store'
import type { PerformanceSnapshot, SlowQuery, SchemaTable, ReplicationStatus, CapacityEntry, SecurityFinding } from '../db-store'
import { collectPostgres } from './pg-collector'
import { collectMysql }    from './mysql-collector'
import { collectMongo }    from './mongo-collector'
import { collectRedis }    from './redis-collector'
import { collectSqlServer } from './mssql-collector'
import { collectCouchbase } from './couchbase-collector'

const DATA_DIR = path.join(process.cwd(), 'data')

function saveJson(file: string, data: unknown) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8')
}
function loadJson<T>(file: string, def: T): T {
  const p = path.join(DATA_DIR, file)
  if (!fs.existsSync(p)) return def
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return def }
}

export interface CollectResult {
  durationMs: number
  dbs: number
  errors: string[]
  collected: {
    snapshots: number
    slowQueries: number
    schemaTables: number
    replication: number
    capacity: number
    security: number
  }
}

export async function runAllCollectors(): Promise<CollectResult> {
  const t0 = Date.now()
  const errors: string[] = []

  const dbs = loadDatabases()

  // Accumulator objects — collectors append to these
  const newSnapshots: PerformanceSnapshot[] = []
  const newSlowQueries: SlowQuery[] = []
  const newSchema: SchemaTable[] = []
  const newReplication: ReplicationStatus[] = []
  const newCapacity: CapacityEntry[] = []
  const newSecurity: SecurityFinding[] = []

  const out = {
    snapshots: newSnapshots,
    slowQueries: newSlowQueries,
    schema: newSchema,
    replication: newReplication,
    capacity: newCapacity,
    security: newSecurity,
  }

  // Run collectors (sequential — avoids connection storms)
  await collectPostgres(dbs, out).catch(e => errors.push(`pg: ${(e as Error).message}`))
  await collectMysql(dbs, { snapshots: out.snapshots, slowQueries: out.slowQueries, schema: out.schema, capacity: out.capacity, security: out.security }).catch(e => errors.push(`mysql: ${(e as Error).message}`))
  await collectMongo(dbs, { snapshots: out.snapshots, slowQueries: out.slowQueries, schema: out.schema, capacity: out.capacity }).catch(e => errors.push(`mongo: ${(e as Error).message}`))
  await collectRedis(dbs, { snapshots: out.snapshots, slowQueries: out.slowQueries, capacity: out.capacity, security: out.security }).catch(e => errors.push(`redis: ${(e as Error).message}`))
  await collectSqlServer(dbs, { snapshots: out.snapshots, slowQueries: out.slowQueries, schema: out.schema, capacity: out.capacity, security: out.security }).catch(e => errors.push(`mssql: ${(e as Error).message}`))
  await collectCouchbase(dbs, { snapshots: out.snapshots, slowQueries: out.slowQueries, schema: out.schema, capacity: out.capacity, security: out.security }).catch(e => errors.push(`couchbase: ${(e as Error).message}`))

  // ── Merge with existing data ──────────────────────────────

  // Snapshots: keep last 48 per DB (rolling 24h at 30min interval)
  const existingSnaps = loadJson<PerformanceSnapshot[]>('perf-snapshots.json', [])
  const snapshotsByDb = new Map<string, PerformanceSnapshot[]>()
  for (const snap of [...existingSnaps, ...newSnapshots]) {
    if (!snapshotsByDb.has(snap.dbId)) snapshotsByDb.set(snap.dbId, [])
    snapshotsByDb.get(snap.dbId)!.push(snap)
  }
  const mergedSnaps: PerformanceSnapshot[] = []
  for (const [, snaps] of snapshotsByDb) {
    snaps.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    mergedSnaps.push(...snaps.slice(0, 48))
  }
  saveJson('perf-snapshots.json', mergedSnaps)

  // Slow queries: deduplicate by id, cap at 200
  const existingSQ = loadJson<SlowQuery[]>('slow-queries.json', [])
  const sqMap = new Map<string, SlowQuery>()
  for (const q of [...existingSQ, ...newSlowQueries]) sqMap.set(q.id, q)
  saveJson('slow-queries.json', [...sqMap.values()].slice(0, 200))

  // Schema: replace entirely (fresh scan)
  if (newSchema.length > 0) saveJson('schema.json', newSchema)

  // Replication: replace entirely (current state)
  if (newReplication.length > 0) saveJson('replication.json', newReplication)

  // Capacity: replace per DB, calculate growth from previous entry
  const existingCap = loadJson<CapacityEntry[]>('capacity.json', [])
  const prevCapMap = new Map<string, CapacityEntry>()
  for (const c of existingCap) prevCapMap.set(c.dbId, c)

  const enrichedCapacity = newCapacity.map(c => {
    const prev = prevCapMap.get(c.dbId)
    let growthMBPerDay = 0
    let daysUntilFull = 0
    if (prev && prev.totalSizeMB > 0 && c.totalSizeMB > 0) {
      const growthMB = c.totalSizeMB - prev.totalSizeMB
      // Only count positive growth; cap at 500 MB/interval to filter methodology changes
      if (growthMB > 0 && growthMB < 500) {
        // 5-min interval → 288 collections/day
        growthMBPerDay = Math.round(growthMB * 288 * 10) / 10
        if (c.freeSizeMB > 0 && growthMBPerDay > 0) {
          daysUntilFull = Math.min(9999, Math.round(c.freeSizeMB / growthMBPerDay))
        }
      }
      // If no growth (idle DB) or spike filtered — leave at 0
    }
    return { ...c, growthMBPerDay, daysUntilFull }
  })

  const capMap = new Map<string, CapacityEntry>()
  for (const c of existingCap)      capMap.set(c.dbId, c)
  for (const c of enrichedCapacity) capMap.set(c.dbId, c)
  saveJson('capacity.json', [...capMap.values()])

  // Security: merge — keep acknowledged/resolved, add new open findings
  const existingSec = loadJson<SecurityFinding[]>('security.json', [])
  const secMap = new Map<string, SecurityFinding>()
  for (const f of existingSec) secMap.set(f.id, f)
  for (const f of newSecurity) {
    if (!secMap.has(f.id)) secMap.set(f.id, f) // don't overwrite acknowledged/resolved
  }
  saveJson('security.json', [...secMap.values()])

  return {
    durationMs: Date.now() - t0,
    dbs: dbs.length,
    errors,
    collected: {
      snapshots: newSnapshots.length,
      slowQueries: newSlowQueries.length,
      schemaTables: newSchema.length,
      replication: newReplication.length,
      capacity: newCapacity.length,
      security: newSecurity.length,
    },
  }
}
