import type { DbConnection, PerformanceSnapshot, SlowQuery, SchemaTable, CapacityEntry, SecurityFinding } from '../db-store'
import { saveDatabase } from '../db-store'
import { getMssqlPool } from '../db-connections'
import crypto from 'crypto'

export async function collectSqlServer(dbs: DbConnection[], out: {
  snapshots: PerformanceSnapshot[]
  slowQueries: SlowQuery[]
  schema: SchemaTable[]
  capacity: CapacityEntry[]
  security: SecurityFinding[]
}) {
  const mssqlDbs = dbs.filter(d => d.engine === 'sqlserver')

  for (const db of mssqlDbs) {
    const pool = await getMssqlPool(db)
    if (!pool) {
      saveDatabase({ ...db, status: 'error', lastChecked: new Date().toISOString(), healthScore: 0 })
      continue
    }

    try {
      // ── Performance snapshot ──────────────────────────────
      const t0 = Date.now()
      await pool.request().query('SELECT 1')
      const latency = Date.now() - t0

      const connRes = await pool.request().query<{ active: number; max: number; total_batches: number; cache_hit_ratio: number }>(`
        SELECT
          (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS active,
          (SELECT value_in_use FROM sys.configurations WHERE name = 'max connections') AS max,
          (SELECT TOP 1 cntr_value FROM sys.dm_os_performance_counters
           WHERE counter_name = 'Batch Requests/sec') AS total_batches,
          (SELECT TOP 1
             CAST(cntr_value AS FLOAT) /
             NULLIF((SELECT TOP 1 cntr_value FROM sys.dm_os_performance_counters
                     WHERE counter_name = 'Buffer cache hit ratio base' AND object_name LIKE '%Buffer Manager%'), 0) * 100
           FROM sys.dm_os_performance_counters
           WHERE counter_name = 'Buffer cache hit ratio' AND object_name LIKE '%Buffer Manager%'
          ) AS cache_hit_ratio
      `)
      const c = connRes.recordset[0]

      out.snapshots.push({
        dbId: db.id, timestamp: new Date().toISOString(),
        tps: Math.round((c?.total_batches ?? 0) / 300),
        latencyP50Ms: latency, latencyP95Ms: latency * 2, latencyP99Ms: latency * 4,
        activeConnections: c?.active ?? 0,
        maxConnections: c?.max || 32767,
        cpuPct: 0, memPct: 0, diskReadMBps: 0, diskWriteMBps: 0,
        cacheHitRatio: Math.min(99.9, Math.round((c?.cache_hit_ratio ?? 99) * 10) / 10),
      })

      // ── Slow queries from dm_exec_query_stats ─────────────
      try {
        const sqRes = await pool.request().query<{ avg_ms: number; text: string; execution_count: number; avg_rows: number }>(`
          SELECT TOP 15
            qs.total_elapsed_time / qs.execution_count / 1000.0 AS avg_ms,
            qs.execution_count,
            qs.total_rows / NULLIF(qs.execution_count, 0) AS avg_rows,
            SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
              ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
                ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS text
          FROM sys.dm_exec_query_stats qs
          CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
          WHERE qs.total_elapsed_time / qs.execution_count > 50000
            AND st.text NOT LIKE '%dm_exec_query_stats%'
          ORDER BY qs.total_elapsed_time / qs.execution_count DESC
        `)
        for (const row of sqRes.recordset) {
          const queryText = (row.text ?? '').trim().substring(0, 500)
          const id = `sq-mssql-${db.id}-${crypto.createHash('md5').update(queryText.substring(0, 80)).digest('hex').substring(0, 16)}`
          if (!out.slowQueries.find(q => q.id === id)) {
            out.slowQueries.push({
              id, dbId: db.id, dbName: db.name, engine: 'sqlserver',
              query: queryText,
              durationMs: Math.round(row.avg_ms),
              rowsReturned: row.avg_rows ?? 0,
              executedAt: new Date().toISOString(), analyzed: false,
            })
          }
        }
      } catch { /* dm_exec_query_stats may need VIEW SERVER STATE */ }

      // ── Schema ────────────────────────────────────────────
      try {
        const tblRes = await pool.request().query<{ table_name: string; schema_name: string; row_count: number; total_mb: number; index_mb: number }>(`
          SELECT
            t.name AS table_name,
            s.name AS schema_name,
            SUM(p.rows) AS row_count,
            SUM(a.total_pages) * 8.0 / 1024 AS total_mb,
            SUM(a.used_pages - a.data_pages) * 8.0 / 1024 AS index_mb
          FROM sys.tables t
          JOIN sys.schemas s ON s.schema_id = t.schema_id
          JOIN sys.indexes i ON i.object_id = t.object_id
          JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id = i.index_id
          JOIN sys.allocation_units a ON a.container_id = p.partition_id
          GROUP BY t.name, s.name
          ORDER BY total_mb DESC
        `)
        for (const tbl of tblRes.recordset.slice(0, 30)) {
          const colRes = await pool.request()
            .input('tbl', tbl.table_name).input('sch', tbl.schema_name)
            .query<{ name: string; type: string; nullable: string; default_val: string }>(`
              SELECT c.name, tp.name AS type,
                     CASE c.is_nullable WHEN 1 THEN 'YES' ELSE 'NO' END AS nullable,
                     dc.definition AS default_val
              FROM sys.columns c
              JOIN sys.types tp ON tp.user_type_id = c.user_type_id
              JOIN sys.tables t ON t.object_id = c.object_id
              JOIN sys.schemas s ON s.schema_id = t.schema_id
              LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
              WHERE t.name = @tbl AND s.name = @sch
              ORDER BY c.column_id
            `)
          const idxRes = await pool.request()
            .input('tbl', tbl.table_name).input('sch', tbl.schema_name)
            .query<{ idx_name: string; is_unique: boolean; cols: string; idx_type: string }>(`
              SELECT i.name AS idx_name, i.is_unique,
                     STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS cols,
                     i.type_desc AS idx_type
              FROM sys.indexes i
              JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
              JOIN sys.columns c ON c.object_id = i.object_id AND c.column_id = ic.column_id
              JOIN sys.tables t ON t.object_id = i.object_id
              JOIN sys.schemas s ON s.schema_id = t.schema_id
              WHERE t.name = @tbl AND s.name = @sch AND i.name IS NOT NULL
              GROUP BY i.name, i.is_unique, i.type_desc
            `)
          out.schema.push({
            dbId: db.id, schema: tbl.schema_name, name: tbl.table_name, engine: 'sqlserver',
            rowCount: tbl.row_count, sizeMB: tbl.total_mb, indexSizeMB: tbl.index_mb,
            columns: colRes.recordset.map((c: { name: string; type: string; nullable: string; default_val: string }) => ({ name: c.name, type: c.type, nullable: c.nullable === 'YES', default: c.default_val })),
            indexes: idxRes.recordset.map((i: { idx_name: string; is_unique: boolean; cols: string; idx_type: string }) => ({ name: i.idx_name, columns: (i.cols ?? '').split(','), unique: i.is_unique, type: i.idx_type })),
            lastAnalyzed: new Date().toISOString(),
          })
        }
      } catch { /* may need db perms */ }

      // ── Capacity ──────────────────────────────────────────
      try {
        const capRes = await pool.request().query<{ total_mb: number; used_mb: number; free_mb: number }>(`
          SELECT
            SUM(size * 8.0 / 1024) AS total_mb,
            SUM(FILEPROPERTY(name, 'SpaceUsed') * 8.0 / 1024) AS used_mb,
            SUM((size - FILEPROPERTY(name, 'SpaceUsed')) * 8.0 / 1024) AS free_mb
          FROM sys.database_files
        `)
        const cap = capRes.recordset[0]
        const topTblRes = await pool.request().query<{ name: string; total_mb: number }>(`
          SELECT TOP 5 t.name,
            SUM(a.total_pages) * 8.0 / 1024 AS total_mb
          FROM sys.tables t
          JOIN sys.indexes i ON i.object_id = t.object_id
          JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id = i.index_id
          JOIN sys.allocation_units a ON a.container_id = p.partition_id
          GROUP BY t.name ORDER BY total_mb DESC
        `)
        out.capacity.push({
          dbId: db.id, dbName: db.name,
          totalSizeMB: Math.round(cap?.total_mb ?? 0),
          dataSizeMB:  Math.round(cap?.used_mb ?? 0),
          indexSizeMB: 0,
          freeSizeMB:  Math.round(cap?.free_mb ?? 0),
          growthMBPerDay: 0, daysUntilFull: 0,
          indexBloatPct: 0, tableBloatPct: 0,
          topTables: topTblRes.recordset.map((r: { name: string; total_mb: number }) => ({ name: r.name, sizeMB: Math.round(r.total_mb), growthMBPerDay: 0 })),
        })
      } catch { /* may need VIEW DATABASE STATE */ }

      // ── Security ──────────────────────────────────────────
      try {
        // Check for SQL logins without password expiry / policy
        const loginRes = await pool.request().query<{ name: string; is_expiration_checked: boolean; is_policy_checked: boolean }>(`
          SELECT name, is_expiration_checked, is_policy_checked
          FROM sys.sql_logins
          WHERE is_disabled = 0 AND name NOT LIKE '##%'
        `)
        for (const row of loginRes.recordset) {
          if (!row.is_policy_checked) {
            const sid = `sec-mssql-policy-${db.id}-${row.name}`
            if (!out.security.find(f => f.id === sid)) {
              out.security.push({
                id: sid, dbId: db.id, dbName: db.name, severity: 'medium',
                category: 'config', title: `SQL login '${row.name}' has no password policy enforced`,
                description: `Login '${row.name}' does not enforce password complexity or expiration.`,
                recommendation: `ALTER LOGIN [${row.name}] WITH CHECK_POLICY = ON, CHECK_EXPIRATION = ON;`,
                detectedAt: new Date().toISOString(), status: 'open',
              })
            }
          }
        }
      } catch { /* may need VIEW SERVER STATE */ }

      saveDatabase({ ...db, status: 'connected', healthScore: 90, lastChecked: new Date().toISOString(), version: 'SQL Server' })

    } catch (e) {
      console.error(`[mssql-collector] Error on ${db.name}:`, (e as Error).message)
      saveDatabase({ ...db, status: 'error', healthScore: 0, lastChecked: new Date().toISOString() })
    }
  }
}
