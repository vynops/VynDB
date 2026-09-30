import { loadDatabases } from './db-store'
import type { AutomationActionType, AutomationRule } from './automation-store'
import { executeMaintenance } from './maintenance-executor'

export interface AutomationExecution {
  status: 'success' | 'failed' | 'skipped' | 'unverified'
  output: string
  dataQuality: 'real' | 'advisory'
}

function isExecutable(action: AutomationActionType): boolean {
  return ['vacuum', 'analyze', 'reindex', 'kill_idle', 'custom_sql'].includes(action)
}

export async function runAutomationRule(rule: AutomationRule, dryRun = false): Promise<AutomationExecution> {
  const actions = rule.actions.filter(action => isExecutable(action.type))
  if (actions.length === 0) return { status: 'skipped', dataQuality: 'advisory', output: 'No executable database action configured; notification-only rule.' }
  if (actions.length !== 1) return { status: 'skipped', dataQuality: 'advisory', output: 'Only one maintenance action per run is supported; no action was executed.' }
  const action = actions[0]
  const preview = `Target: ${rule.dbName}\n${action.sql ?? ''}`
  if (dryRun) return { status: 'skipped', dataQuality: 'advisory', output: `DRY RUN — no changes applied.\n\n${preview}` }

  const db = loadDatabases().find(item => item.id === rule.dbId)
  if (!db) return { status: 'failed', dataQuality: 'advisory', output: `Database not found: ${rule.dbName}` }
  const result = await executeMaintenance(db, action.type, action.sql ?? '')
  return { status: result.status === 'verified' ? 'success' : result.status === 'advisory' ? 'skipped' : result.status,
    dataQuality: result.status === 'advisory' ? 'advisory' : 'real', output: result.output }
}