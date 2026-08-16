import { getPgPool, getMysqlPool } from './db-connections'
import { loadDatabases } from './db-store'
import type { AutomationActionType, AutomationRule } from './automation-store'

const TIMEOUT_MS = 60_000

export interface AutomationExecution {
  status: 'success' | 'failed' | 'skipped'
  output: string
  dataQuality: 'real' | 'advisory'
}

function isExecutable(action: AutomationActionType): boolean {
  return ['vacuum', 'analyze', 'reindex', 'kill_idle', 'custom_sql'].includes(action)
}

function statementsFor(rule: AutomationRule): string[] {
  return rule.actions.filter(action => isExecutable(action.type)).flatMap(action => {
    if (action.type === 'vacuum') return [action.sql || 'VACUUM (VERBOSE, ANALYZE);']
    if (action.type === 'analyze') return [action.sql || 'ANALYZE;']
    if (action.type === 'reindex') return [action.sql || 'REINDEX DATABASE;']
    if (action.type === 'kill_idle') return [action.sql || '']
    return [action.sql || '']
  }).filter(Boolean)
}

export async function runAutomationRule(rule: AutomationRule, dryRun = false): Promise<AutomationExecution> {
  const statements = statementsFor(rule)
  if (statements.length === 0) return { status: 'skipped', dataQuality: 'advisory', output: 'No executable database action configured; notification-only rule.' }
  const preview = statements.map(statement => `Target: ${rule.dbName}\n${statement}`).join('\n\n')
  if (dryRun) return { status: 'skipped', dataQuality: 'advisory', output: `DRY RUN — no changes applied.\n\n${preview}` }

  const db = loadDatabases().find(item => item.id === rule.dbId)
  if (!db) return { status: 'failed', dataQuality: 'advisory', output: `Database not found: ${rule.dbName}` }
  if (db.engine !== 'postgresql' && db.engine !== 'mysql') {
    return { status: 'skipped', dataQuality: 'advisory', output: `No verified executor is available for ${db.engine}. Manual execution required.\n\n${preview}` }
  }

  try {
    const outputs: string[] = []
    if (db.engine === 'postgresql') {
      const pool = await getPgPool(db)
      if (!pool) return { status: 'failed', dataQuality: 'real', output: `Cannot connect to ${db.name}` }
      for (const statement of statements) {
        const result = await Promise.race([
          pool.query(statement),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Automation timed out')), TIMEOUT_MS)),
        ])
        outputs.push(`${statement}\nCompleted; rows affected: ${result.rowCount ?? 0}`)
      }
    } else {
      const pool = await getMysqlPool(db)
      if (!pool) return { status: 'failed', dataQuality: 'real', output: `Cannot connect to ${db.name}` }
      for (const statement of statements) {
        const [result] = await Promise.race([
          pool.execute(statement),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Automation timed out')), TIMEOUT_MS)),
        ]) as [unknown, unknown]
        outputs.push(`${statement}\nCompleted; result: ${JSON.stringify(result).substring(0, 500)}`)
      }
    }
    return { status: 'success', dataQuality: 'real', output: outputs.join('\n\n') }
  } catch (error) {
    return { status: 'failed', dataQuality: 'real', output: `Execution failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}