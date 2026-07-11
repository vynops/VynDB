import type { Pool } from 'pg'
import type { DbConnection, PerformanceSnapshot, SlowQuery, SchemaTable, ReplicationStatus, CapacityEntry, SecurityFinding } from '../db-store'
import { saveDatabase } from '../db-store'
import { getPgPool } from '../db-connections'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

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

export async function collectPostgres(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  schema: SchemaTable[]
  replication: ReplicationStatus[]
  capacity: CapacityEntry[]
  security: SecurityFinding[]
}) {
  const pgDbs = dbs.filter(d => d.engine === 'postgresql')

  for (const db of pgDbs) {
    const pool = await getPgPool(db) as Pool | null
    if (!pool) {
      saveDatabase({ ...db, status: 'error', lastChecked: new Date().toISOString(), healthScore: 0 })
      continue
    }

    try {
      // ── Performance snapshot ──────────────────────────────
      const [dbStats, connSettings] = await Promise.all([
        pool.query<{ connections: string; total_xacts: string; blks_hit: string; blks_read: string; cache_hit_ratio: string }>(
          `SELECT numbackends AS connections,
                  xact_commit + xact_rollback AS total_xacts,
                  blks_hit, blks_read,
                  CASE WHEN blks_hit + blks_read > 0
                    THEN round(100.0 * blks_hit / (blks_hit + blks_read), 2) ELSE 100
                  END AS cache_hit_ratio
           FROM pg_stat_database WHERE datname = current_database()`
        ),
        pool.query<{ max_conn: string }>(
          `SELECT setting::int AS max_conn FROM pg_settings WHERE name = 'max_connections'`
        ),
      ])

      const t0 = Date.now()
      await pool.query('SELECT 1')
      const latency = Date.now() - t0

      out.snapshots.push({
        dbId: db.id, timestamp: new Date().toISOString(),
        tps: Math.round(parseInt(dbStats.rows[0].total_xacts) / 300),
        latencyP50Ms: latency, latencyP95Ms: latency * 2, latencyP99Ms: latency * 4,
        activeConnections: parseInt(dbStats.rows[0].connections),
        maxConnections: parseInt(connSettings.rows[0].max_conn),
        cpuPct: 0, memPct: 0, diskReadMBps: 0, diskWriteMBps: 0,
        cacheHitRatio: parseFloat(dbStats.rows[0].cache_hit_ratio),
      })

      // ── Slow queries from pg_stat_statements ─────────────
      try {
        const sqRes = await pool.query<{ query_id: string; query: string; mean_ms: string; avg_rows: string }>(
          `SELECT queryid::text AS query_id, query,
                  mean_exec_time AS mean_ms,
                  rows / NULLIF(calls, 0) AS avg_rows
           FROM pg_stat_statements
           WHERE mean_exec_time > 50
             AND query NOT LIKE '%pg_stat_statements%'
             AND query NOT LIKE '%pg_isready%'
           ORDER BY mean_exec_time DESC LIMIT 15`
        )
        for (const row of sqRes.rows) {
          const id = `sq-pg-${db.id}-${row.query_id}`
          if (!out.slowQueries.find(q => q.id === id)) {
            out.slowQueries.push({
              id, dbId: db.id, dbName: db.name, engine: 'postgresql',
              query: row.query.substring(0, 500),
              durationMs: Math.round(parseFloat(row.mean_ms)),
              rowsReturned: parseInt(row.avg_rows) || 0,
              executedAt: new Date().toISOString(), analyzed: false,
            })
          }
        }
      } catch { /* pg_stat_statements not available */ }

      // ── Schema ───────────────────────────────────────────
      const tblRes = await pool.query<{ schema_name: string; table_name: string; row_count: string; total_mb: string; index_mb: string }>(
        `SELECT t.table_schema AS schema_name, t.table_name,
                COALESCE(c.reltuples::bigint, 0) AS row_count,
                COALESCE(pg_total_relation_size(c.oid)/1024.0/1024.0, 0) AS total_mb,
                COALESCE(pg_indexes_size(c.oid)/1024.0/1024.0, 0) AS index_mb
         FROM information_schema.tables t
         LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relkind = 'r'
         WHERE t.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
           AND t.table_type = 'BASE TABLE'
         ORDER BY total_mb DESC LIMIT 30`
      )

      for (const tbl of tblRes.rows) {
        const [colRes, idxRes] = await Promise.all([
          pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string }>(
            `SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [tbl.schema_name, tbl.table_name]
          ),
          pool.query<{ index_name: string; is_unique: boolean; cols: string[]; index_type: string }>(
            `SELECT i.relname AS index_name, ix.indisunique AS is_unique,
                    array_to_json(array_agg(a.attname ORDER BY k.pos)) AS cols, am.amname AS index_type
             FROM pg_index ix
             JOIN pg_class i  ON i.oid = ix.indexrelid
             JOIN pg_class t2 ON t2.oid = ix.indrelid
             JOIN pg_am am    ON am.oid = i.relam
             CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, pos)
             JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
             WHERE t2.relname = $1
             GROUP BY i.relname, ix.indisunique, am.amname LIMIT 10`,
            [tbl.table_name]
          ),
        ])

        out.schema.push({
          dbId: db.id, schema: tbl.schema_name, name: tbl.table_name,
          engine: 'postgresql',
          rowCount: parseInt(tbl.row_count), sizeMB: parseFloat(tbl.total_mb),
          indexSizeMB: parseFloat(tbl.index_mb),
          columns: colRes.rows.map(c => ({ name: c.column_name, type: c.data_type, nullable: c.is_nullable === 'YES', default: c.column_default })),
          indexes: idxRes.rows.map(i => ({ name: i.index_name, columns: i.cols, unique: i.is_unique, type: i.index_type?.toUpperCase() ?? 'BTREE' })),
          lastAnalyzed: new Date().toISOString(),
        })
      }

      // ── Replication ──────────────────────────────────────
      try {
        const [isPrimary, replRes] = await Promise.all([
          pool.query<{ is_primary: boolean }>('SELECT NOT pg_is_in_recovery() AS is_primary'),
          pool.query<{ client_addr: string; state: string; lag_bytes: string; replay_lag_sec: string }>(
            `SELECT client_addr::text, state,
                    (sent_lsn - replay_lsn) AS lag_bytes,
                    EXTRACT(EPOCH FROM replay_lag) AS replay_lag_sec
             FROM pg_stat_replication`
          ),
        ])

        if (isPrimary.rows[0].is_primary) {
          out.replication.push({
            dbId: db.id, dbName: db.name, engine: 'postgresql', role: 'primary',
            lagSeconds: 0, connectedReplicas: replRes.rows.length,
            lastSyncAt: new Date().toISOString(), status: 'healthy',
          })
        } else {
          const walRecv = await pool.query<{ status: string; lag_sec: string }>(
            `SELECT status, EXTRACT(EPOCH FROM (now()-last_msg_receipt_time)) AS lag_sec
             FROM pg_stat_wal_receiver LIMIT 1`
          )
          if (walRecv.rows.length > 0) {
            const lag = parseFloat(walRecv.rows[0].lag_sec) || 0
            out.replication.push({
              dbId: db.id, dbName: db.name, engine: 'postgresql', role: 'replica',
              lagSeconds: lag, syncState: walRecv.rows[0].status,
              lastSyncAt: new Date().toISOString(),
              status: lag > 30 ? 'critical' : lag > 5 ? 'warning' : 'healthy',
            })
          }
        }
      } catch { /* replication views may not be accessible */ }

      // ── Capacity ─────────────────────────────────────────
      const [dbSz, tblBloat, sizeSplit] = await Promise.all([
        pool.query<{ size_mb: string }>(
          `SELECT pg_database_size(current_database())/1024.0/1024.0 AS size_mb`
        ),
        pool.query<{ relname: string; total_mb: string; dead_pct: string }>(
          `SELECT relname,
                  pg_total_relation_size(schemaname||'.'||relname)/1024.0/1024.0 AS total_mb,
                  CASE WHEN n_live_tup+n_dead_tup>0
                    THEN round(100.0*n_dead_tup/(n_live_tup+n_dead_tup),1) ELSE 0
                  END AS dead_pct
           FROM pg_stat_user_tables ORDER BY total_mb DESC LIMIT 10`
        ),
        pool.query<{ data_mb: string; index_mb: string }>(
          `SELECT
             COALESCE(SUM(pg_total_relation_size(c.oid) - pg_indexes_size(c.oid)),0)/1024.0/1024.0 AS data_mb,
             COALESCE(SUM(pg_indexes_size(c.oid)),0)/1024.0/1024.0 AS index_mb
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`
        ),
      ])

      const totalMB  = parseFloat(dbSz.rows[0].size_mb) || 0
      const dataMB   = parseFloat(sizeSplit.rows[0]?.data_mb ?? '0') || 0
      const indexMB  = parseFloat(sizeSplit.rows[0]?.index_mb ?? '0') || 0
      const maxBloat = tblBloat.rows.reduce((acc, r) => Math.max(acc, parseFloat(r.dead_pct) || 0), 0)

      out.capacity.push({
        dbId: db.id, dbName: db.name,
        totalSizeMB: totalMB,
        dataSizeMB:  Math.round(dataMB),
        indexSizeMB: Math.round(indexMB),
        freeSizeMB:  Math.max(0, Math.round(totalMB - dataMB - indexMB)),
        growthMBPerDay: 0, daysUntilFull: 0,   // calculated in index.ts from history
        indexBloatPct: maxBloat, tableBloatPct: Math.round(maxBloat * 0.7),
        topTables: tblBloat.rows.slice(0, 5).map(r => ({
          name: r.relname, sizeMB: Math.round(parseFloat(r.total_mb)), growthMBPerDay: 0,
        })),
      })

      // ── Security ─────────────────────────────────────────
      const [suRes, sslRes] = await Promise.all([
        pool.query<{ rolname: string }>(
          `SELECT rolname FROM pg_roles WHERE rolsuper = true AND rolcanlogin = true`
        ),
        pool.query<{ ssl: string }>('SHOW ssl'),
      ])

      for (const row of suRes.rows) {
        const sid = `sec-pg-su-${db.id}-${row.rolname}`
        if (!out.security.find(f => f.id === sid)) {
          out.security.push({
            id: sid, dbId: db.id, dbName: db.name, severity: 'high',
            category: 'privilege', title: `Superuser login role: ${row.rolname}`,
            description: `Role '${row.rolname}' has SUPERUSER + LOGIN. All-privilege role used for application access.`,
            recommendation: `Create a least-privilege role: REVOKE SUPERUSER FROM ${row.rolname};`,
            detectedAt: new Date().toISOString(), status: 'open',
          })
        }
      }

      if (sslRes.rows[0]?.ssl !== 'on') {
        const sid = `sec-pg-ssl-${db.id}`
        if (!out.security.find(f => f.id === sid)) {
          out.security.push({
            id: sid, dbId: db.id, dbName: db.name, severity: 'medium',
            category: 'encryption', title: 'SSL not enabled',
            description: 'PostgreSQL SSL is off. All connections are unencrypted.',
            recommendation: "Set ssl=on in postgresql.conf and restart.",
            detectedAt: new Date().toISOString(), status: 'open',
          })
        }
      }

      // Update DB status
      saveDatabase({ ...db, status: 'connected', healthScore: 92, lastChecked: new Date().toISOString() })

    } catch (e) {
      console.error(`[pg-collector] Error on ${db.name}:`, (e as Error).message)
      saveDatabase({ ...db, status: 'error', healthScore: 0, lastChecked: new Date().toISOString() })
    }
  }
}
