export type MaintenanceEngine = 'postgresql' | 'mysql'

export function permittedMaintenanceSql(engine: string, action: string, sql: string): string | null {
  if (action !== 'analyze') return null
  const statement = sql.trim()
  const identifier = '[a-zA-Z_][a-zA-Z0-9_]*'
  const table = `${identifier}\\.${identifier}`

  if (engine === 'postgresql' && new RegExp(`^ANALYZE\\s+${table};?$`, 'i').test(statement)) {
    return statement
  }
  if (engine === 'mysql' && new RegExp(`^ANALYZE\\s+TABLE\\s+${identifier};?$`, 'i').test(statement)) {
    return statement
  }
  return null
}