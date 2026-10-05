import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadIncidents, addIncident } from '@/lib/incident-store'
import { notifyIncident } from '@/lib/notifier'
import { matchRouting, findOpenIncidentDuplicate } from '@/lib/incident-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const list = loadIncidents()
  return NextResponse.json(status ? list.filter(i => i.status === status) : list)
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  let body
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Incident body must be an object' }, { status: 400 })
  }
  if (typeof body.title !== 'string' || !body.title.trim() || !['critical', 'high', 'medium', 'low'].includes(body.severity) || !['performance', 'availability', 'replication', 'backup', 'security', 'capacity', 'other'].includes(body.category)) {
    return NextResponse.json({ error: 'Valid title, severity, and category are required' }, { status: 400 })
  }
  if (typeof body.dbId !== 'string' || typeof body.dbName !== 'string' || (body.source !== undefined && !['auto', 'manual'].includes(body.source))) {
    return NextResponse.json({ error: 'Valid database and source are required' }, { status: 400 })
  }
  if (['notes', 'assignedTo'].some(field => body[field] !== undefined && typeof body[field] !== 'string')) {
    return NextResponse.json({ error: 'Invalid incident field value' }, { status: 400 })
  }
  const data = { dbId: body.dbId, dbName: body.dbName, title: body.title.trim(), severity: body.severity, category: body.category, source: body.source ?? 'manual', status: 'open' as const, notes: body.notes, assignedTo: body.assignedTo }
  const duplicate = findOpenIncidentDuplicate(data)
  if (duplicate) return NextResponse.json(duplicate, { status: 200, headers: { 'X-VynDB-Deduplicated': 'true' } })
  const inc = addIncident(data, auth.email)
  const rule = matchRouting(inc.severity, inc.category)
  await notifyIncident(inc, rule)

  return NextResponse.json(inc, { status: 201 })
}
