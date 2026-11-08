import crypto from 'node:crypto'
import type { DbConnection, PerformanceSnapshot, SlowQuery, SchemaTable, ReplicationStatus, CapacityEntry, SecurityFinding, DbStatus } from '../db-store'
import { saveDatabase } from '../db-store'
import { getSettings } from '../settings-store'
import { couchbaseJson, runCouchbaseQuery } from '../couchbase-client'

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

interface CouchbaseScope {
  name: string
  collections?: { name: string }[]
}

interface CouchbaseQueryResponse {
  results?: Record<string, unknown>[]
  metrics?: { executionTime?: string; elapsedTime?: string; resultCount?: number; processedObjects?: number }
  requestId?: string
  requestTime?: string
}

interface CouchbaseTask {
  type?: string
  status?: string
  id?: string
  replicationId?: string
  source?: string
  target?: string
  changesLeft?: number | string
  startTime?: string
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

function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``
}

function parseDurationMs(value?: string): number | undefined {
  if (!value) return undefined
  const match = value.trim().match(/^([\d.]+)\s*(ns|us|µs|ms|s|m)$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  const units: Record<string, number> = { ns: 1e-6, us: 1e-3, 'µs': 1e-3, ms: 1, s: 1000, m: 60_000 }
  return Number.isFinite(amount) ? amount * (units[match[2].toLowerCase()] ?? 1) : undefined
}

function getInferredColumns(response: CouchbaseQueryResponse): SchemaTable['columns'] {
  const result = response.results?.[0]?.result as { properties?: Record<string, { type?: string | string[]; format?: string }> } | undefined
  return Object.entries(result?.properties ?? {}).map(([name, value]) => ({
    name,
    type: Array.isArray(value.type) ? value.type.join(' | ') : value.type ?? value.format ?? 'unknown',
    nullable: true,
  }))
}

export async function collectCouchbase(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  schema: SchemaTable[]
  replication: ReplicationStatus[]
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
      const nodeCpu = nodes.map(n => n.systemStats?.cpu_utilization_rate).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      const nodeConnections = nodes.map(n => n.interestingStats?.curr_connections).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      const ramQuota = pool.storageTotals?.ram?.quotaTotal ?? 0
      const ramUsed = pool.storageTotals?.ram?.usedByData ?? 0
      const nodeMemoryTotal = sum(nodes.map(n => n.systemStats?.mem_total ?? 0))
      const nodeMemoryUsed = sum(nodes.map(n => n.systemStats?.mem_used ?? 0))
      const memPct = nodeMemoryTotal > 0
        ? Math.round((nodeMemoryUsed / nodeMemoryTotal) * 100)
        : ramQuota > 0 ? Math.round((ramUsed / ramQuota) * 100) : undefined

      const hddTotal = pool.storageTotals?.hdd?.total ?? 0
      const hddUsed = pool.storageTotals?.hdd?.usedByData ?? 0
      const freeMB = Math.max(0, toMB(hddTotal - hddUsed))

      const bucketOps = buckets.map(b => b.basicStats?.opsPerSec).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      const tps = bucketOps.length > 0 ? Math.round(sum(bucketOps)) : undefined
      const activeConnections = nodeConnections.length > 0 ? Math.round(sum(nodeConnections)) : undefined

      out.snapshots.push({
        dbId: db.id,
        timestamp: new Date().toISOString(),
        latencyP50Ms: latency,
        ...(tps !== undefined ? { tps } : {}),
        ...(activeConnections !== undefined ? { activeConnections } : {}),
        ...(nodeCpu.length > 0 ? { cpuPct: Math.round(avg(nodeCpu) * 10) / 10 } : {}),
        ...(memPct !== undefined ? { memPct } : {}),
      })

      if (hddTotal > 0) {
        out.capacity.push({
          dbId: db.id,
          dbName: db.name,
          totalSizeMB: toMB(hddTotal),
          dataSizeMB: toMB(sum(buckets.map(b => b.basicStats?.dataUsed ?? 0))),
          freeSizeMB: freeMB,
          growthMBPerDay: 0,
          daysUntilFull: 0,
          topItemsLabel: 'buckets',
          topTables: buckets.slice(0, 5).map(b => ({
            name: b.name,
            sizeMB: toMB((b.basicStats?.diskUsed ?? b.basicStats?.dataUsed ?? 0)),
            growthMBPerDay: 0,
          })),
        })
      }

      // Bucket scopes and collections are the native Couchbase schema surface.
      for (const bucket of buckets) {
        const scopeResponse = await couchbaseJson<{ scopes?: CouchbaseScope[] }>(
          db,
          `/pools/default/buckets/${encodeURIComponent(bucket.name)}/scopes`,
        ).catch(() => ({ scopes: [] }))

        for (const scope of scopeResponse.scopes ?? []) {
          for (const collection of scope.collections ?? []) {
            const keyspace = `${quoteIdentifier(bucket.name)}.${quoteIdentifier(scope.name)}.${quoteIdentifier(collection.name)}`
            let columns: SchemaTable['columns'] = []
            let indexes: SchemaTable['indexes'] = []

            try {
              const inferred = await runCouchbaseQuery<CouchbaseQueryResponse>(db, `INFER ${keyspace} WITH {"sample_size":100}`, { timeoutMs: 15_000 })
              columns = getInferredColumns(inferred)
            } catch { /* Query Service privileges or infer support may be unavailable. */ }

            try {
              const indexResult = await runCouchbaseQuery<CouchbaseQueryResponse>(
                db,
                'SELECT name, is_primary, index_key FROM system:indexes WHERE bucket_id = $1 AND scope_id = $2 AND keyspace_id = $3',
                { timeoutMs: 10_000, args: [bucket.name, scope.name, collection.name] },
              )
              indexes = (indexResult.results ?? []).map(index => ({
                name: String(index.name ?? 'unknown'),
                columns: Array.isArray(index.index_key) ? index.index_key.map(String) : [],
                unique: false,
                type: index.is_primary ? 'PRIMARY' : 'GSI',
              }))
            } catch { /* Index metadata requires Query Service catalog privileges. */ }

            out.schema.push({
              dbId: db.id,
              schema: `${bucket.name}.${scope.name}`,
              name: collection.name,
              engine: 'couchbase',
              columns,
              indexes,
            })
          }
        }
      }

      // Query Service retains completed requests only when request logging is enabled.
      try {
        const completed = await couchbaseJson<{ completed_requests?: (CouchbaseQueryResponse & { statement?: string })[] }>(
          db,
          '/admin/completed_requests',
          {},
          true,
        )
        const threshold = getSettings().slowQueryThresholdMs
        for (const request of completed.completed_requests ?? []) {
          const durationMs = parseDurationMs(request.metrics?.executionTime ?? request.metrics?.elapsedTime)
          if (!request.statement || durationMs === undefined || durationMs < threshold) continue
          const requestId = request.requestId ?? crypto.createHash('sha256').update(`${request.statement}:${request.requestTime ?? ''}`).digest('hex').slice(0, 20)
          if (out.slowQueries.some(query => query.id === `sq-couchbase-${db.id}-${requestId}`)) continue
          const executedAt = request.requestTime && Number.isFinite(Date.parse(request.requestTime))
            ? new Date(request.requestTime).toISOString()
            : new Date().toISOString()
          out.slowQueries.push({
            id: `sq-couchbase-${db.id}-${requestId}`,
            dbId: db.id,
            dbName: db.name,
            engine: 'couchbase',
            query: request.statement.slice(0, 2000),
            durationMs: Math.round(durationMs),
            rowsExamined: request.metrics?.processedObjects,
            rowsReturned: request.metrics?.resultCount,
            executedAt,
            analyzed: false,
          })
        }
      } catch { /* Query Service admin endpoint requires additional privileges. */ }

      // XDCR exposes task state and changes remaining, not a time-based lag.
      try {
        const tasks = await couchbaseJson<CouchbaseTask[]>(db, '/pools/default/tasks')
        for (const [index, task] of tasks.entries()) {
          if (!task.type?.toLowerCase().includes('xdcr')) continue
          const state = task.status ?? 'unknown'
          const changesLeft = Number(task.changesLeft)
          const hasChanges = Number.isFinite(changesLeft)
          const normalized = state.toLowerCase()
          const status: ReplicationStatus['status'] = normalized.includes('error') || normalized.includes('fail')
            ? 'critical'
            : normalized === 'running' && (!hasChanges || changesLeft === 0) ? 'healthy' : 'warning'
          const taskId = task.id ?? task.replicationId ?? String(index)
          out.replication.push({
            dbId: `${db.id}-xdcr-${taskId}`,
            parentDbId: db.id,
            dbName: `${db.name}${task.target ? ` → ${task.target}` : ' XDCR'}`,
            engine: 'couchbase',
            role: 'replica',
            lagLabel: hasChanges ? `${changesLeft.toLocaleString()} changes remaining` : state,
            changesRemaining: hasChanges ? changesLeft : undefined,
            syncState: state,
            lastSyncAt: task.startTime && Number.isFinite(Date.parse(task.startTime)) ? new Date(task.startTime).toISOString() : new Date().toISOString(),
            status,
          })
        }
      } catch { /* XDCR task visibility requires appropriate cluster privileges. */ }

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
      if (memPct !== undefined && memPct >= 85) healthScore -= 25
      if (latency > 200) healthScore -= 10
      healthScore = clamp(healthScore, 0, 100)

      version = pool.implementationVersion || nodes[0]?.version || db.version
    } catch (e) {
      // Detailed stats failed (e.g. cluster not fully initialized or 401)
      // but the /pools ping succeeded — mark connected with reduced score
      console.warn(`[couchbase-collector] Stats unavailable for ${db.name}:`, (e as Error).message)
      healthScore = 70

      // Retain the successful probe latency; omit metrics unavailable from this response.
      out.snapshots.push({
        dbId: db.id,
        timestamp: new Date().toISOString(),
        latencyP50Ms: latency,
      })
    }

    const status: DbStatus = healthScore >= 80 ? 'connected' : healthScore >= 60 ? 'warning' : 'error'
    saveDatabase({ ...db, status, healthScore, lastChecked: new Date().toISOString(), version })
  }
}

