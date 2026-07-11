import type { DbConnection, PerformanceSnapshot, SlowQuery, SchemaTable, CapacityEntry } from '../db-store'
import { saveDatabase } from '../db-store'
import { getMongoClient } from '../db-connections'

export async function collectMongo(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  schema: SchemaTable[]
  capacity: CapacityEntry[]
}) {
  const mongoDbs = dbs.filter(d => d.engine === 'mongodb')

  for (const db of mongoDbs) {
    const client = await getMongoClient(db)
    if (!client) {
      saveDatabase({ ...db, status: 'error', lastChecked: new Date().toISOString(), healthScore: 0 })
      continue
    }

    try {
      const mdb = client.db(db.database)

      // ── Server status ────────────────────────────────────
      const serverStatus = await mdb.command({ serverStatus: 1 }) as {
        connections?: { current: number; available: number }
        opcounters?: { query?: number; insert?: number; update?: number; delete?: number }
        mem?: { resident: number; virtual: number }
        uptime?: number
      }

      const ops = serverStatus.opcounters ?? {}
      const totalOps = (ops.query ?? 0) + (ops.insert ?? 0) + (ops.update ?? 0) + (ops.delete ?? 0)
      const uptime = serverStatus.uptime ?? 1

      const t0 = Date.now()
      await mdb.command({ ping: 1 })
      const latency = Date.now() - t0

      out.snapshots.push({
        dbId: db.id, timestamp: new Date().toISOString(),
        tps: Math.round(totalOps / uptime),
        latencyP50Ms: latency, latencyP95Ms: latency * 2, latencyP99Ms: latency * 3,
        activeConnections: serverStatus.connections?.current ?? 0,
        maxConnections: (serverStatus.connections?.current ?? 0) + (serverStatus.connections?.available ?? 100),
        cpuPct: 0, memPct: 0, diskReadMBps: 0, diskWriteMBps: 0,
        cacheHitRatio: 0,
      })

      // ── Slow queries from system.profile ─────────────────
      try {
        const profileDocs = await mdb.collection('system.profile')
          .find({ millis: { $gt: 100 }, ns: { $not: /system\.profile/ } })
          .sort({ ts: -1 })
          .limit(15)
          .toArray() as unknown as Array<{ op: string; ns: string; command?: Record<string, unknown>; millis: number; nreturned?: number; ts: Date; keysExamined?: number; docsExamined?: number }>

        for (const doc of profileDocs) {
          const queryText = JSON.stringify(doc.command ?? { op: doc.op, ns: doc.ns }).substring(0, 500)
          const id = `sq-mongo-${db.id}-${Buffer.from(queryText.substring(0, 40)).toString('hex').substring(0, 16)}`
          if (!out.slowQueries.find(q => q.id === id)) {
            out.slowQueries.push({
              id, dbId: db.id, dbName: db.name, engine: 'mongodb',
              query: queryText, durationMs: doc.millis,
              rowsExamined: doc.docsExamined, rowsReturned: doc.nreturned,
              executedAt: doc.ts?.toISOString() ?? new Date().toISOString(), analyzed: false,
            })
          }
        }
      } catch { /* profile collection may be empty or inaccessible */ }

      // ── Collections (schema equivalent) ──────────────────
      const collections = await mdb.listCollections().toArray()
      for (const col of collections) {
        if (col.name === 'system.profile') continue
        try {
          const stats = await mdb.command({ collStats: col.name }) as {
            ns: string; count: number; size: number; avgObjSize: number;
            storageSize: number; totalIndexSize: number; nindexes: number;
            indexSizes?: Record<string, number>
          }

          out.schema.push({
            dbId: db.id, schema: db.database, name: col.name, engine: 'mongodb',
            rowCount: stats.count ?? 0,
            sizeMB: Math.round((stats.size ?? 0) / 1024 / 1024 * 100) / 100,
            indexSizeMB: Math.round((stats.totalIndexSize ?? 0) / 1024 / 1024 * 100) / 100,
            columns: [],   // MongoDB is schemaless
            indexes: Object.keys(stats.indexSizes ?? {}).map(name => ({
              name, columns: [], unique: name === '_id_', type: 'BTREE',
            })),
            lastAnalyzed: new Date().toISOString(),
          })
        } catch { /* skip if collStats fails */ }
      }

      // ── Capacity ─────────────────────────────────────────
      const dbStats = await mdb.command({ dbStats: 1 }) as {
        dataSize: number; storageSize: number; indexSize: number; fsTotalSize: number; fsUsedSize: number
      }
      const dataMB  = Math.round((dbStats.dataSize    ?? 0) / 1024 / 1024)
      const indexMB = Math.round((dbStats.indexSize   ?? 0) / 1024 / 1024)
      const totalMB = dataMB + indexMB   // actual used — not pre-allocated storageSize
      const diskFreeMB = Math.round(((dbStats.fsTotalSize ?? 0) - (dbStats.fsUsedSize ?? 0)) / 1024 / 1024)

      out.capacity.push({
        dbId: db.id, dbName: db.name,
        totalSizeMB: totalMB, dataSizeMB: dataMB,
        indexSizeMB: indexMB, freeSizeMB: diskFreeMB,
        growthMBPerDay: 0, daysUntilFull: 0,   // calculated in index.ts
        indexBloatPct: 5, tableBloatPct: 3,
        topTables: out.schema.filter(s => s.dbId === db.id).slice(0, 5).map(s => ({
          name: s.name, sizeMB: s.sizeMB, growthMBPerDay: 0,
        })),
      })

      saveDatabase({ ...db, status: 'connected', healthScore: 90, lastChecked: new Date().toISOString() })

    } catch (e) {
      console.error(`[mongo-collector] Error on ${db.name}:`, (e as Error).message)
      saveDatabase({ ...db, status: 'error', healthScore: 0, lastChecked: new Date().toISOString() })
    }
  }
}
