import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRules, saveRule } from '@/lib/automation-store'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadRules())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const rule = {
    id: `rule-${crypto.randomUUID().slice(0, 8)}`,
    name: body.name,
    description: body.description ?? '',
    dbId: body.dbId ?? '*',
    dbName: body.dbName ?? 'All databases',
    trigger: body.trigger ?? 'cron',
    cronExpr: body.cronExpr,
    cronLabel: body.cronLabel,
    thresholdMetric: body.thresholdMetric,
    thresholdOperator: body.thresholdOperator,
    thresholdValue: body.thresholdValue,
    actions: body.actions ?? [],
    enabled: body.enabled ?? true,
    runCount: 0,
    createdAt: new Date().toISOString(),
    tags: body.tags ?? [],
  }
  saveRule(rule)
  return NextResponse.json(rule, { status: 201 })
}
