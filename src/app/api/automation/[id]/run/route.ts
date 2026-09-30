import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRules, saveRule, addRun } from '@/lib/automation-store'
import crypto from 'crypto'
import { appendAudit } from '@/lib/audit-store'
import { runAutomationRule } from '@/lib/automation-runner'
import { loadDatabases } from '@/lib/db-store'
import { claimExecution, finishExecution, releaseExecution } from '@/lib/execution-claims'
import { permittedMaintenanceSql } from '@/lib/maintenance-policy'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const rules = loadRules()
  const rule = rules.find(r => r.id === id)
  if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean; requestId?: string }

  const actions = rule.actions.filter(action => !['slack_notify', 'email_notify'].includes(action.type))
  const executable = actions.length === 1 && permittedMaintenanceSql(
    loadDatabases().find(db => db.id === rule.dbId)?.engine ?? '', actions[0].type, actions[0].sql ?? ''
  )
  if (!body.dryRun && executable && (typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.requestId))) {
    return NextResponse.json({ error: 'A unique requestId is required for execution' }, { status: 400 })
  }
  const requestClaim = executable && !body.dryRun ? claimExecution(`rule-request:${id}:${body.requestId}`) : null
  if (requestClaim && !requestClaim.claimed) {
    return NextResponse.json({ error: 'This request has already been attempted; inspect its claim before retrying.', claim: requestClaim.record }, { status: 409 })
  }
  const lock = requestClaim ? claimExecution(`rule-lock:${id}`) : null
  if (lock && !lock.claimed) {
    finishExecution(requestClaim!.record, 'skipped')
    return NextResponse.json({ error: 'A previous rule execution is running or needs investigation.', claim: lock.record }, { status: 409 })
  }

  const startedAt = new Date().toISOString()
  const execution = await runAutomationRule(rule, body.dryRun === true)
  const { status, output } = execution
  if (requestClaim && lock) {
    finishExecution(requestClaim.record, status, status === 'unverified')
    finishExecution(lock.record, status, status === 'unverified')
    if (status !== 'unverified') releaseExecution(lock.record)
  }
  const completedAt = new Date().toISOString()

  const run = { id: `run-${crypto.randomUUID().slice(0, 8)}`, ruleId: id, startedAt, completedAt, status, output, triggeredBy: 'manual' as const }
  addRun(run)

  // Update rule with last run info
  const updated = { ...rule, lastRunAt: startedAt, lastRunStatus: status, lastRunOutput: output, runCount: body.dryRun ? rule.runCount : rule.runCount + 1 }
  saveRule(updated)
  appendAudit({ actor: auth.email, action: body.dryRun ? 'automation.dry_run' : 'automation.run', resource: 'automation-rule', resourceId: id, success: status === 'success', details: { status, dataQuality: execution.dataQuality, output: output.substring(0, 2000) } })

  return NextResponse.json({ ok: status === 'success' || status === 'skipped', status, output, dataQuality: execution.dataQuality, run }, { status: status === 'failed' || status === 'unverified' ? 422 : 200 })
}
