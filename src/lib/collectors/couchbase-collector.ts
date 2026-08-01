import type { DbConnection, PerformanceSnapshot, SlowQuery, SchemaTable, CapacityEntry, SecurityFinding, DbStatus } from '../db-store'
import { saveDatabase } from '../db-store'

interface CouchbaseNode {
  status?: string
  version?: string
  interestingStats?: {
    ops?: number
    curr_connections?: number
  }
  systemStats?: {
    cpu_utilization_rate?: number
    mem_total?: number
    mem_used?: number
  }
}

interface CouchbasePoolDefault {
  implementationVersion?: string
  nodes?: CouchbaseNode[]
  storageTotals?: {
    ram?: { quotaTotal?: number; usedByData?: number }
    hdd?: { total?: number; usedByData?: number }
  }
}

interface CouchbaseBucket {
  name: string
  basicStats?: {
    dataUsed?: number
    diskUsed?: number
    itemCount?: number
    opsPerSec?: number
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

function couchbaseBaseUrl(db: DbConnection): string {
  return `${db.ssl ? 'https' : 'http'}://${db.host}:${db.port}`
}

async function couchbaseJson<T>(db: DbConnection, apiPath: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (db.username) {
    const auth = Buffer.from(`${db.username}:${db.passwordEnc}`).toString('base64')
    headers.Authorization = `Basic ${auth}`
  }

  const res = await fetch(`${couchbaseBaseUrl(db)}${apiPath}`, {
    headers,
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`Couchbase API ${apiPath} failed (${res.status})`)
  return await res.json() as T
}

export async function collectCouchbase(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  schema: SchemaTable[]
  capacity: CapacityEntry[]
  security: SecurityFinding[]
}) {
  const couchbaseDbs = dbs.filter(d => d.engine === 'couchbase')

  for (const db of couchbaseDbs) {
    // ── Step 1: basic reachability ping ─────────────────────
    let latency = 0
    try {
      const t0 = Date.now()
      await couchbaseJson<Record<string, unknown>>(db, '/pools')
      latency = Date.now() - t0
    } catch (e) {
      console.error(`[couchbase-collector] Unreachable ${db.name}:`, (e as Error).message)
      saveDatabase({ ...db, status: 'error', healthScore: 0, lastChecked: new Date().toISOString() })
      continue
    }

    // ── Step 2: detailed stats (best-effort; never marks error) ─
    let healthScore = 85
    let version: string | undefined = db.version

    try {
      const pool = await couchbaseJson<CouchbasePoolDefault>(db, '/pools/default')
      const buckets = await couchbaseJson<CouchbaseBucket[]>(db, '/pools/default/buckets').catch(() => [])

      const nodes = pool.nodes ?? []
      // Couchbase Community uses 'active'; Enterprise uses 'healthy' — accept both
      const healthyNodes = nodes.filter(n => n.status === 'healthy' || n.status === 'active').length
      const nodeCpu = nodes.map(n => n.systemStats?.cpu_utilization_rate ?? 0)
      const nodeConnections = nodes.map(n => n.interestingStats?.curr_connections ?? 0)
      const nodeOps = nodes.map(n => n.interestingStats?.ops ?? 0)

      const ramQuota = pool.storageTotals?.ram?.quotaTotal ?? 0
      const ramUsed = pool.storageTotals?.ram?.usedByData ?? 0
      const memPct = ramQuota > 0 ? Math.round((ramUsed / ramQuota) * 100) : 0

      const hddTotal = pool.storageTotals?.hdd?.total ?? 0
      const hddUsed = pool.storageTotals?.hdd?.usedByData ?? 0
      const freeMB = Math.max(0, toMB(hddTotal - hddUsed))

      const bucketOps = sum(buckets.map(b => b.basicStats?.opsPerSec ?? 0))
      const tps = Math.round(sum(nodeOps) || bucketOps)
      const activeConnections = Math.round(sum(nodeConnections))
      const maxConnections = Math.max(200, activeConnections + 50)

      out.snapshots.push({
        dbId: db.id,
        timestamp: new Date().toISOString(),
        tps,
        latencyP50Ms: latency,
        latencyP95Ms: latency * 2,
        latencyP99Ms: latency * 3,
        activeConnections,
        maxConnections,
        cpuPct: Math.round(avg(nodeCpu) * 10) / 10,
        memPct,
        diskReadMBps: 0,
        diskWriteMBps: 0,
        cacheHitRatio: 95,
      })

      out.capacity.push({
        dbId: db.id,
        dbName: db.name,
        totalSizeMB: toMB(hddTotal),
        dataSizeMB: toMB(ramUsed),
        indexSizeMB: 0,
        freeSizeMB: freeMB,
        growthMBPerDay: 0,
        daysUntilFull: 0,
        indexBloatPct: 0,
        tableBloatPct: 0,
        topTables: buckets
          .slice(0, 5)
          .map(b => ({
            name: b.name,
            sizeMB: toMB((b.basicStats?.diskUsed ?? b.basicStats?.dataUsed ?? 0)),
            growthMBPerDay: 0,
          })),
      })

      if (!db.username || !db.passwordEnc) {
        const sid = `sec-couchbase-auth-${db.id}`
        if (!out.security.find(f => f.id === sid)) {
          out.security.push({
            id: sid,
            dbId: db.id,
            dbName: db.name,
            severity: 'high',
            category: 'auth',
            title: 'Couchbase admin authentication may be missing',
            description: 'Connection does not provide a username/password pair for Couchbase management API access.',
            recommendation: 'Use a dedicated admin user with strong password and least required privileges.',
            detectedAt: new Date().toISOString(),
            status: 'open',
          })
        }
      }

      healthScore = 95
      if (nodes.length > 0 && healthyNodes < nodes.length) healthScore -= 20
      if (memPct >= 85) healthScore -= 25
      if (latency > 200) healthScore -= 10
      healthScore = clamp(healthScore, 0, 100)

      version = pool.implementationVersion || nodes[0]?.version || db.version
    } catch (e) {
      // Detailed stats failed (e.g. cluster not fully initialized or 401)
      // but the /pools ping succeeded — mark connected with reduced score
      console.warn(`[couchbase-collector] Stats unavailable for ${db.name}:`, (e as Error).message)
      healthScore = 70

      // Emit a minimal snapshot so the card shows live latency at minimum
      out.snapshots.push({
        dbId: db.id,
        timestamp: new Date().toISOString(),
        tps: 0, latencyP50Ms: latency,
        latencyP95Ms: latency * 2, latencyP99Ms: latency * 3,
        activeConnections: 0, maxConnections: 200,
        cpuPct: 0, memPct: 0,
        diskReadMBps: 0, diskWriteMBps: 0,
        cacheHitRatio: 0,
      })
    }

    const status: DbStatus = healthScore >= 80 ? 'connected' : healthScore >= 60 ? 'warning' : 'error'
    saveDatabase({ ...db, status, healthScore, lastChecked: new Date().toISOString(), version })
  }
}

