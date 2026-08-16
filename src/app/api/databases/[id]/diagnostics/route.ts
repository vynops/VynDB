import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases } from '@/lib/db-store'
import { getPgPool, getMysqlPool, getMssqlPool, getMongoClient, getRedisClient } from '@/lib/db-connections'

type DiagnosticResult = {
  locks: unknown[]
  blockers: unknown[]
  waits: unknown[]
  deadlocks: unknown[]
  warnings: string[]
}

const emptyResult = (): DiagnosticResult => ({ locks: [], blockers: [], waits: [], deadlocks: [], warnings: [] })

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const db = loadDatabases().find(item => item.id === id)
  if (!db) return NextResponse.json({ error: 'Database not found' }, { status: 404 })

  const result = emptyResult()
  try {
    if (db.engine === 'postgresql') {
      const pool = await getPgPool(db)
      if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const [activity, locks, deadlocks] = await Promise.all([
        pool.query(`SELECT pid, usename, state, wait_event_type, wait_event, now() - query_start AS query_age, left(query, 500) AS query
          FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() ORDER BY query_start ASC NULLS LAST LIMIT 100`),
        pool.query(`SELECT blocked.pid AS blocked_pid, blocking.pid AS blocking_pid, blocked.query AS blocked_query, blocking.query AS blocking_query
          FROM pg_stat_activity blocked JOIN pg_locks blocked_lock ON blocked_lock.pid = blocked.pid AND NOT blocked_lock.granted
          JOIN pg_locks blocking_lock ON blocking_lock.locktype = blocked_lock.locktype AND blocking_lock.database IS NOT DISTINCT FROM blocked_lock.database
          AND blocking_lock.relation IS NOT DISTINCT FROM blocked_lock.relation AND blocking_lock.granted
          JOIN pg_stat_activity blocking ON blocking.pid = blocking_lock.pid WHERE blocked.pid <> blocking.pid LIMIT 100`),
        pool.query(`SELECT datname, deadlocks, stats_reset FROM pg_stat_database WHERE datname = current_database()`),
      ])
      result.waits = activity.rows.filter(row => row.wait_event_type)
      result.locks = locks.rows
      result.blockers = locks.rows.map(row => ({ pid: row.blocking_pid, query: row.blocking_query }))
      result.deadlocks = deadlocks.rows
    } else if (db.engine === 'mysql') {
      const pool = await getMysqlPool(db)
      if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const [processes] = await pool.query(`SHOW FULL PROCESSLIST`)
      const [innodb] = await pool.query(`SELECT * FROM information_schema.innodb_trx`)
      result.waits = (processes as Array<Record<string, unknown>>).filter(row => row.State)
      result.locks = innodb as unknown[]
      result.warnings.push('MySQL lock waits and deadlock history require performance_schema and InnoDB instrumentation permissions.')
    } else if (db.engine === 'sqlserver') {
      const pool = await getMssqlPool(db)
      if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const response = await pool.request().query(`SELECT r.session_id, r.blocking_session_id, r.status, r.wait_type, r.wait_time, r.wait_resource, r.command, LEFT(t.text, 500) AS query_text
        FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t WHERE r.session_id <> @@SPID`)
      result.waits = response.recordset.filter(row => row.wait_type)
      result.blockers = response.recordset.filter(row => Number(row.blocking_session_id) > 0)
      result.locks = response.recordset
      result.warnings.push('SQL Server deadlock history requires an Extended Events or system-health session integration.')
    } else if (db.engine === 'mongodb') {
      const client = await getMongoClient(db)
      if (!client) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const currentOp = await client.db('admin').command({ currentOp: true, active: true }) as { inprog?: unknown[] }
      result.waits = currentOp.inprog ?? []
      result.warnings.push('MongoDB lock and deadlock data is represented through current operations; historical deadlocks require server monitoring.')
    } else if (db.engine === 'redis') {
      const redis = await getRedisClient(db)
      if (!redis) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const clients = await redis.call('CLIENT', 'LIST') as string
      result.locks = clients.split('\n').filter(Boolean).map(client => ({ client }))
      result.warnings.push('Redis does not expose relational locks or blockers; client activity is shown instead.')
    } else {
      result.warnings.push('Diagnostics are not available for this engine.')
    }
  } catch (error) {
    result.warnings.push(error instanceof Error ? error.message : String(error))
  }

  return NextResponse.json({ dbId: db.id, dbName: db.name, engine: db.engine, dataQuality: result.warnings.length ? 'partial' : 'real', ...result })
}