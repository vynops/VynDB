import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRules, saveRule, addRun } from '@/lib/automation-store'
import crypto from 'crypto'
import { appendAudit } from '@/lib/audit-store'
import { runAutomationRule } from '@/lib/automation-runner'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const rules = loadRules()
  const rule = rules.find(r => r.id === id)
  if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean }

  const startedAt = new Date().toISOString()
  const execution = await runAutomationRule(rule, body.dryRun === true)
  const { status, output } = execution
  const completedAt = new Date().toISOString()

  const run = { id: `run-${crypto.randomUUID().slice(0, 8)}`, ruleId: id, startedAt, completedAt, status, output, triggeredBy: 'manual' as const }
  addRun(run)

  // Update rule with last run info
  const updated = { ...rule, lastRunAt: startedAt, lastRunStatus: status, lastRunOutput: output, runCount: body.dryRun ? rule.runCount : rule.runCount + 1 }
  saveRule(updated)
  appendAudit({ actor: auth.email, action: body.dryRun ? 'automation.dry_run' : 'automation.run', resource: 'automation-rule', resourceId: id, success: status !== 'failed', details: { status, dataQuality: execution.dataQuality, output: output.substring(0, 2000) } })

  return NextResponse.json({ ok: status !== 'failed', status, output, dataQuality: execution.dataQuality, run }, { status: status === 'failed' ? 422 : 200 })
}
