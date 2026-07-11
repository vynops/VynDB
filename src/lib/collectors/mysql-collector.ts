import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { DbConnection, PerformanceSnapshot, SlowQuery, SchemaTable, CapacityEntry, SecurityFinding } from '../db-store'
import { saveDatabase } from '../db-store'
import { getMysqlPool } from '../db-connections'

export async function collectMysql(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  schema: SchemaTable[]
  capacity: CapacityEntry[]
  security: SecurityFinding[]
}) {
  const mysqlDbs = dbs.filter(d => d.engine === 'mysql')

  for (const db of mysqlDbs) {
    const pool = await getMysqlPool(db) as Pool | null
    if (!pool) {
      saveDatabase({ ...db, status: 'error', lastChecked: new Date().toISOString(), healthScore: 0 })
      continue
    }

    try {
      // ── Status variables ──────────────────────────────────
      const [statusRows] = await pool.query<RowDataPacket[]>(
        `SHOW GLOBAL STATUS WHERE Variable_name IN (
          'Threads_connected','Max_used_connections','Queries','Uptime',
          'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads',
          'Bytes_received','Bytes_sent'
        )`
      )
      const stat: Record<string, string> = {}
      statusRows.forEach((r) => { stat[r.Variable_name] = r.Value })

      const [varRows] = await pool.query<RowDataPacket[]>(
        `SHOW GLOBAL VARIABLES WHERE Variable_name IN ('max_connections','innodb_buffer_pool_size')`
      )
      const vars: Record<string, string> = {}
      varRows.forEach((r) => { vars[r.Variable_name] = r.Value })

      const buffHit = parseInt(stat.Innodb_buffer_pool_read_requests) || 0
      const buffMiss = parseInt(stat.Innodb_buffer_pool_reads) || 0
      const cacheHit = buffHit + buffMiss > 0 ? Math.round(100 * buffHit / (buffHit + buffMiss)) : 100

      const t0 = Date.now()
      await pool.query('SELECT 1')
      const latency = Date.now() - t0

      out.snapshots.push({
        dbId: db.id, timestamp: new Date().toISOString(),
        tps: Math.round(parseInt(stat.Queries || '0') / (parseInt(stat.Uptime || '1'))),
        latencyP50Ms: latency, latencyP95Ms: latency * 2, latencyP99Ms: latency * 4,
        activeConnections: parseInt(stat.Threads_connected || '0'),
        maxConnections: parseInt(vars.max_connections || '151'),
        cpuPct: 0, memPct: 0, diskReadMBps: 0, diskWriteMBps: 0,
        cacheHitRatio: cacheHit,
      })

      // ── Slow queries from performance_schema ─────────────
      try {
        const [sqRows] = await pool.query<RowDataPacket[]>(
          `SELECT digest_text, avg_timer_wait, avg_rows_sent, schema_name
           FROM performance_schema.events_statements_summary_by_digest
           WHERE avg_timer_wait > 100000000000
             AND digest_text NOT LIKE '%performance_schema%'
           ORDER BY avg_timer_wait DESC LIMIT 15`
        )
        for (const row of sqRows) {
          const id = `sq-mysql-${db.id}-${Buffer.from(((row as RowDataPacket).digest_text ?? '').substring(0,50)).toString('hex').substring(0,16)}`
          if (!out.slowQueries.find(q => q.id === id)) {
            out.slowQueries.push({
              id, dbId: db.id, dbName: db.name, engine: 'mysql',
              query: (row as RowDataPacket).digest_text?.substring(0, 500) ?? '',
              durationMs: Math.round(parseInt((row as RowDataPacket).avg_timer_wait) / 1000000),
              rowsReturned: parseInt((row as RowDataPacket).avg_rows_sent) || 0,
              executedAt: new Date().toISOString(), analyzed: false,
            })
          }
        }
      } catch { /* performance_schema may not be accessible */ }

      // ── Schema ───────────────────────────────────────────
      const [tblRows] = await pool.query<RowDataPacket[]>(
        `SELECT table_name, table_rows,
                (data_length + index_length)/1024/1024 AS total_mb,
                data_length/1024/1024 AS data_mb,
                index_length/1024/1024 AS index_mb
         FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
         ORDER BY total_mb DESC LIMIT 30`
      )

      for (const tbl of tblRows) {
        const [colRows] = await pool.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
          [tbl.table_name]
        )
        const [idxRows] = await pool.query<RowDataPacket[]>(
          `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, INDEX_TYPE
           FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
           ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
          [tbl.table_name]
        )

        const idxMap = new Map<string, { cols: string[]; unique: boolean; type: string }>()
        for (const ix of idxRows) {
          if (!idxMap.has(ix.INDEX_NAME)) {
            idxMap.set(ix.INDEX_NAME, { cols: [], unique: ix.NON_UNIQUE === 0, type: ix.INDEX_TYPE })
          }
          idxMap.get(ix.INDEX_NAME)!.cols.push(ix.COLUMN_NAME)
        }

        out.schema.push({
          dbId: db.id, schema: db.database, name: tbl.table_name, engine: 'mysql',
          rowCount: parseInt(tbl.table_rows) || 0,
          sizeMB: parseFloat(tbl.total_mb) || 0,
          indexSizeMB: parseFloat(tbl.index_mb) || 0,
          columns: colRows.map(c => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE, nullable: c.IS_NULLABLE === 'YES', default: c.COLUMN_DEFAULT })),
          indexes: [...idxMap.entries()].map(([name, i]) => ({ name, columns: i.cols, unique: i.unique, type: i.type })),
          lastAnalyzed: new Date().toISOString(),
        })
      }

      // ── Capacity ─────────────────────────────────────────
      const [szRows] = await pool.query<RowDataPacket[]>(
        `SELECT
           SUM(data_length)/1024/1024     AS data_mb,
           SUM(index_length)/1024/1024    AS index_mb,
           SUM(data_free)/1024/1024       AS free_mb,
           SUM(data_length + index_length)/1024/1024 AS total_mb
         FROM information_schema.tables WHERE table_schema = DATABASE()`
      )
      const sz       = szRows[0] as RowDataPacket
      const totalMB  = parseFloat(sz?.total_mb as string) || 0
      const dataMB   = parseFloat(sz?.data_mb  as string) || 0
      const indexMB  = parseFloat(sz?.index_mb as string) || 0
      const freeMB   = parseFloat(sz?.free_mb  as string) || 0

      // bloat: InnoDB data_free as % of allocated space
      const bloatPct = totalMB > 0 ? Math.round((freeMB / (totalMB + freeMB)) * 100) : 0

      out.capacity.push({
        dbId: db.id, dbName: db.name,
        totalSizeMB: totalMB, dataSizeMB: Math.round(dataMB),
        indexSizeMB: Math.round(indexMB), freeSizeMB: Math.round(freeMB),
        growthMBPerDay: 0, daysUntilFull: 0,   // calculated in index.ts
        indexBloatPct: bloatPct, tableBloatPct: Math.round(bloatPct * 0.6),
        topTables: (tblRows as RowDataPacket[]).slice(0, 5).map(r => ({
          name: String(r.table_name ?? r.TABLE_NAME ?? ''),
          sizeMB: Math.round(parseFloat(r.total_mb as string) || 0),
          growthMBPerDay: 0,
        })),
      })

      // ── Security ─────────────────────────────────────────
      try {
        const [userRows] = await pool.query<RowDataPacket[]>(
          `SELECT user, host,
                  (authentication_string IS NOT NULL AND authentication_string != '') AS has_pass
           FROM mysql.user WHERE account_locked = 'N'`
        )
        for (const row of userRows) {
          if (!row.has_pass) {
            const sid = `sec-mysql-nopw-${db.id}-${row.user}`
            if (!out.security.find(f => f.id === sid)) {
              out.security.push({
                id: sid, dbId: db.id, dbName: db.name, severity: 'critical',
                category: 'auth', title: `MySQL user without password: '${row.user}'@'${row.host}'`,
                description: `Account '${row.user}'@'${row.host}' has no password set.`,
                recommendation: `ALTER USER '${row.user}'@'${row.host}' IDENTIFIED BY '<strong_password>';`,
                detectedAt: new Date().toISOString(), status: 'open',
              })
            }
          }
        }
      } catch { /* mysql.user may require GRANT permission */ }

      saveDatabase({ ...db, status: 'connected', healthScore: 89, lastChecked: new Date().toISOString() })

    } catch (e) {
      console.error(`[mysql-collector] Error on ${db.name}:`, (e as Error).message)
      saveDatabase({ ...db, status: 'error', healthScore: 0, lastChecked: new Date().toISOString() })
    }
  }
}
