import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRouting, saveRouting } from '@/lib/incident-store'
import crypto from 'crypto'
import { appendAudit } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadRouting())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  if (typeof body.name !== 'string' || !body.name.trim() || !['*', 'critical', 'high', 'medium', 'low'].includes(body.severity ?? '*') || !['*', 'performance', 'availability', 'replication', 'backup', 'security', 'capacity', 'other'].includes(body.category ?? '*') || !Array.isArray(body.notifyEmails) || body.notifyEmails.some((email: unknown) => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return NextResponse.json({ error: 'Invalid routing rule name, severity, category, or email list' }, { status: 400 })
  }
  const rules = loadRouting()
  const rule = { id: crypto.randomUUID().slice(0, 8), name: body.name.trim(), severity: body.severity ?? '*', category: body.category ?? '*', notifyEmails: body.notifyEmails, notifySlack: body.notifySlack === true, notifyTeams: body.notifyTeams === true, notifyWebhook: body.notifyWebhook === true, notifyOncall: body.notifyOncall === true, escalationPolicyId: body.escalationPolicyId ?? 'default' }
  rules.push(rule)
  saveRouting(rules)
  appendAudit({ actor: auth.email, action: 'routing.create', resource: 'routing-rule', resourceId: rule.id, success: true, details: { name: rule.name } })
  return NextResponse.json(rule, { status: 201 })
}
