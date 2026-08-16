import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRouting, saveRouting } from '@/lib/incident-store'
import { appendAudit } from '@/lib/audit-store'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json() as Record<string, unknown>
  const allowed = ['name', 'severity', 'category', 'notifyEmails', 'notifySlack', 'notifyTeams', 'notifyWebhook', 'notifyOncall', 'escalationPolicyId']
  if (Object.keys(body).some(key => !allowed.includes(key))) return NextResponse.json({ error: 'Invalid routing fields' }, { status: 400 })
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) return NextResponse.json({ error: 'Rule name is required' }, { status: 400 })
  if (body.notifyEmails !== undefined && (!Array.isArray(body.notifyEmails) || body.notifyEmails.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) return NextResponse.json({ error: 'Invalid notification email list' }, { status: 400 })
  const rules = loadRouting()
  const idx = rules.findIndex(r => r.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  rules[idx] = { ...rules[idx], ...body, id }
  saveRouting(rules)
  appendAudit({ actor: auth.email, action: 'routing.update', resource: 'routing-rule', resourceId: id, success: true, details: { fields: Object.keys(body) } })
  return NextResponse.json(rules[idx])
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const filtered = loadRouting().filter(r => r.id !== id)
  if (filtered.length === loadRouting().length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  saveRouting(filtered)
  appendAudit({ actor: auth.email, action: 'routing.delete', resource: 'routing-rule', resourceId: id, success: true })
  return NextResponse.json({ ok: true })
}
