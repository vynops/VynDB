import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { patchIncident, matchRouting } from '@/lib/incident-store'
import { notifyIncident } from '@/lib/notifier'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Incident body must be an object' }, { status: 400 })
  }
  const allowed = ['status', 'acknowledgedAt', 'resolvedAt', 'assignedTo', 'notes']
  if (Object.keys(body).some(key => !allowed.includes(key))) return NextResponse.json({ error: 'Invalid incident fields' }, { status: 400 })
  if (body.status !== undefined && !['open', 'acknowledged', 'resolved'].includes(String(body.status))) return NextResponse.json({ error: 'Invalid incident status' }, { status: 400 })
  for (const field of ['assignedTo', 'notes']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') return NextResponse.json({ error: 'Invalid incident field value' }, { status: 400 })
  }
  delete body.acknowledgedAt
  delete body.resolvedAt
  const updated = patchIncident(id, body, auth.email)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (body.status) {
    const key = body.status === 'open' ? 'initial' : `status:${updated.status}:${updated.acknowledgedAt ?? ''}:${updated.resolvedAt ?? ''}`
    await notifyIncident(updated, matchRouting(updated.severity, updated.category), key)
  }
  return NextResponse.json(updated)
}
