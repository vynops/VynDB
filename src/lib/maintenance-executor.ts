import { getPgPool, getMysqlPool } from './db-connections'
import type { DbConnection } from './db-store'
import { permittedMaintenanceSql } from './maintenance-policy'

export interface MaintenanceResult {
  status: 'verified' | 'unverified' | 'failed' | 'advisory'
  output: string
}

export async function executeMaintenance(db: DbConnection, action: string, sql: string): Promise<MaintenanceResult> {
  const statement = permittedMaintenanceSql(db.engine, action, sql)
  if (!statement) return { status: 'advisory', output: 'No approved executor for this action and SQL. Review and run it manually.' }

  const tableName = statement.replace(/^ANALYZE\s+(?:TABLE\s+)?/i, '').replace(/;$/, '')
  try {
    if (db.engine === 'postgresql') {
      const pool = await getPgPool(db)
      if (!pool) return { status: 'failed', output: `Cannot connect to ${db.name}` }
      const [schema, table] = tableName.includes('.') ? tableName.split('.') : ['public', tableName]
      const check = 'SELECT last_analyze FROM pg_stat_all_tables WHERE schemaname = $1 AND relname = $2'
      const before = await pool.query(check, [schema, table])
      if (before.rows.length !== 1) return { status: 'failed', output: `Table ${tableName} was not found in statistics` }
      const previous = before.rows[0].last_analyze ? new Date(before.rows[0].last_analyze).getTime() : 0
      const client = await pool.connect()
      let attempted = false
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '60s'")
        attempted = true
        await client.query(statement)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        return { status: attempted ? 'unverified' : 'failed', output: `Maintenance was not verified: ${error instanceof Error ? error.message : String(error)}` }
      } finally {
        client.release()
      }
      await pool.query('SELECT pg_stat_clear_snapshot()')
      const after = await pool.query(check, [schema, table])
      const current = after.rows[0]?.last_analyze ? new Date(after.rows[0].last_analyze).getTime() : 0
      return current > previous
        ? { status: 'verified', output: `ANALYZE ${tableName} completed; last_analyze advanced to ${after.rows[0].last_analyze}` }
        : { status: 'unverified', output: `ANALYZE ${tableName} returned, but last_analyze did not advance. Check the database before retrying.` }
    }

    const pool = await getMysqlPool(db)
    if (!pool) return { status: 'failed', output: `Cannot connect to ${db.name}` }
    let attempted = false
    try {
      attempted = true
      const [rows] = await pool.execute({ sql: statement, timeout: 60_000 })
      const messages = rows as Array<{ Msg_type?: string; Msg_text?: string }>
      return Array.isArray(messages) && messages.length > 0 && messages.every(row => row.Msg_type?.toLowerCase() === 'status' && row.Msg_text?.toLowerCase() === 'ok')
        ? { status: 'verified', output: `ANALYZE TABLE ${tableName} returned OK for every table` }
        : { status: 'unverified', output: `ANALYZE TABLE ${tableName} returned without a verified OK status. Inspect the database before retrying.` }
    } catch (error) {
      return { status: attempted ? 'unverified' : 'failed', output: `Maintenance was not verified: ${error instanceof Error ? error.message : String(error)}` }
    }
  } catch (error) {
    return { status: 'unverified', output: `Maintenance outcome unknown: ${error instanceof Error ? error.message : String(error)}. Inspect the database before retrying.` }
  }
}