import type { DbConnection, PerformanceSnapshot, SlowQuery, CapacityEntry, SecurityFinding } from '../db-store'
import { saveDatabase } from '../db-store'
import { getRedisClient } from '../db-connections'

interface ParsedInfo { [section: string]: Record<string, string> }

function parseRedisInfo(raw: string): ParsedInfo {
  const result: ParsedInfo = {}
  let section = 'default'
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      if (trimmed.startsWith('# ')) section = trimmed.slice(2).toLowerCase()
      continue
    }
    const eq = trimmed.indexOf(':')
    if (eq === -1) continue
    if (!result[section]) result[section] = {}
    result[section][trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return result
}

export async function collectRedis(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  capacity: CapacityEntry[]
  security: SecurityFinding[]
}) {
  const redisDbs = dbs.filter(d => d.engine === 'redis')

  for (const db of redisDbs) {
    const redis = await getRedisClient(db)
    if (!redis) {
      saveDatabase({ ...db, status: 'error', lastChecked: new Date().toISOString(), healthScore: 0 })
      continue
    }

    try {
      const infoRaw = await redis.info()
      const info = parseRedisInfo(infoRaw)
      const srv = info['server'] ?? {}
      const clients = info['clients'] ?? {}
      const memory = info['memory'] ?? {}
      const stats = info['stats'] ?? {}
      const repl = info['replication'] ?? {}

      const maxMem = parseInt(memory['maxmemory'] ?? '0')
      const usedMem = parseInt(memory['used_memory'] ?? '0')
      const memPct = maxMem > 0 ? Math.round(100 * usedMem / maxMem) : 0

      const t0 = Date.now()
      await redis.ping()
      const latency = Date.now() - t0

      out.snapshots.push({
        dbId: db.id, timestamp: new Date().toISOString(),
        tps: parseInt(stats['instantaneous_ops_per_sec'] ?? '0'),
        latencyP50Ms: latency, latencyP95Ms: latency * 2, latencyP99Ms: latency * 3,
        activeConnections: parseInt(clients['connected_clients'] ?? '0'),
        maxConnections: parseInt(clients['maxclients'] ?? '10000'),
        cpuPct: 0, memPct,
        diskReadMBps: 0, diskWriteMBps: 0,
        cacheHitRatio: (() => {
          const hits = parseInt(stats['keyspace_hits'] ?? '0')
          const misses = parseInt(stats['keyspace_misses'] ?? '0')
          return hits + misses > 0 ? Math.round(100 * hits / (hits + misses)) : 100
        })(),
      })

      // ── Slow log ─────────────────────────────────────────
      try {
        const slowlog = await redis.call('SLOWLOG', 'GET', '20') as unknown[]
        if (Array.isArray(slowlog)) {
          for (const entry of slowlog) {
            const arr = entry as [number, number, number, string[], string, string]
            const id = `sq-redis-${db.id}-${arr[0]}`
            const cmd = Array.isArray(arr[3]) ? arr[3].join(' ').substring(0, 200) : String(arr[3])
            const durationMicros = arr[2] ?? 0
            if (!out.slowQueries.find(q => q.id === String(id))) {
              out.slowQueries.push({
                id: String(id), dbId: db.id, dbName: db.name, engine: 'redis',
                query: cmd, durationMs: Math.round(durationMicros / 1000),
                executedAt: new Date(arr[1] * 1000).toISOString(), analyzed: false,
              })
            }
          }
        }
      } catch { /* slowlog may not be accessible */ }

      // ── Capacity ─────────────────────────────────────────
      const usedMB = Math.round(usedMem / 1024 / 1024)
      const maxMB  = maxMem > 0 ? Math.round(maxMem / 1024 / 1024) : 256

      // Get top keyspace info
      const dbKeys = info['keyspace'] ?? {}
      const topTables = Object.entries(dbKeys).map(([dbNum, v]) => {
        const keys = parseInt((v as string).split(',')[0].split('=')[1] ?? '0')
        return { name: `db${dbNum}`, sizeMB: 0, growthMBPerDay: 0, rowCount: keys }
      })

      out.capacity.push({
        dbId: db.id, dbName: db.name,
        totalSizeMB: maxMB, dataSizeMB: usedMB,
        indexSizeMB: 0, freeSizeMB: maxMB - usedMB,
        growthMBPerDay: 1, daysUntilFull: maxMB - usedMB > 0 ? Math.round((maxMB - usedMB)) : 0,
        indexBloatPct: 0, tableBloatPct: 0,
        topTables: topTables.slice(0, 5).map(t => ({ name: t.name, sizeMB: t.sizeMB, growthMBPerDay: t.growthMBPerDay })),
      })

      // ── Security ─────────────────────────────────────────
      const hasAuth = db.passwordEnc && db.passwordEnc.length > 0
      if (!hasAuth) {
        const sid = `sec-redis-noauth-${db.id}`
        if (!out.security.find(f => f.id === sid)) {
          out.security.push({
            id: sid, dbId: db.id, dbName: db.name, severity: 'high',
            category: 'auth', title: 'Redis running without authentication',
            description: 'No requirepass is set. Any client on the network can access this Redis instance.',
            recommendation: 'Set requirepass in redis.conf or start with --requirepass <strong_password>.',
            detectedAt: new Date().toISOString(), status: 'open',
          })
        }
      }

      if (memPct >= 80) {
        const sid = `sec-redis-mem-${db.id}`
        const existing = out.security.find(f => f.id === sid)
        if (!existing) {
          out.security.push({
            id: sid, dbId: db.id, dbName: db.name, severity: memPct >= 95 ? 'critical' : 'medium',
            category: 'config', title: `Redis memory at ${memPct}% of maxmemory`,
            description: `Used: ${usedMB} MB / ${maxMB} MB (${memPct}%). OOM write errors imminent if maxmemory-policy is noeviction.`,
            recommendation: "CONFIG SET maxmemory-policy allkeys-lru  (for cache workloads)",
            detectedAt: new Date().toISOString(), status: 'open',
          })
        }
      }

      saveDatabase({ ...db, status: 'connected', healthScore: memPct < 80 ? 95 : 70, lastChecked: new Date().toISOString() })

    } catch (e) {
      console.error(`[redis-collector] Error on ${db.name}:`, (e as Error).message)
      saveDatabase({ ...db, status: 'error', healthScore: 0, lastChecked: new Date().toISOString() })
    }
  }
}
