import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRules, saveRule, simulateRun, addRun } from '@/lib/automation-store'
import crypto from 'crypto'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const rules = loadRules()
  const rule = rules.find(r => r.id === id)
  if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const startedAt = new Date().toISOString()
  const { status, output } = simulateRun(rule)
  const completedAt = new Date().toISOString()

  const run = { id: `run-${crypto.randomUUID().slice(0, 8)}`, ruleId: id, startedAt, completedAt, status, output, triggeredBy: 'manual' as const }
  addRun(run)

  // Update rule with last run info
  const updated = { ...rule, lastRunAt: startedAt, lastRunStatus: status, lastRunOutput: output, runCount: rule.runCount + 1 }
  saveRule(updated)

  return NextResponse.json({ ok: true, status, output, run })
}
