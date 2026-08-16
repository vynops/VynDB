import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { patchIncident } from '@/lib/incident-store'
import { appendAudit } from '@/lib/audit-store'
import { getSessionFromRequest } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json() as Record<string, unknown>
  const allowed = ['status', 'acknowledgedAt', 'resolvedAt', 'assignedTo', 'notes']
  if (Object.keys(body).some(key => !allowed.includes(key))) return NextResponse.json({ error: 'Invalid incident fields' }, { status: 400 })
  if (body.status !== undefined && !['open', 'acknowledged', 'resolved'].includes(String(body.status))) return NextResponse.json({ error: 'Invalid incident status' }, { status: 400 })
  const updated = patchIncident(id, body)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const session = await getSessionFromRequest(req)
  appendAudit({ actor: session?.email ?? 'unknown', action: 'incident.update', resource: 'incident', resourceId: id, success: true, details: { fields: Object.keys(body) } })
  return NextResponse.json(updated)
}
