import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSla, saveSla } from '@/lib/incident-store'
import { appendAudit } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadSla())
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const severities = ['critical', 'high', 'medium', 'low']
  if (typeof body !== 'object' || body === null || severities.some(severity => !body[severity] || !Number.isFinite(body[severity].ackMinutes) || !Number.isFinite(body[severity].resolveMinutes) || body[severity].ackMinutes < 1 || body[severity].resolveMinutes < body[severity].ackMinutes)) {
    return NextResponse.json({ error: 'Each SLA tier needs positive ack and resolve minutes; resolve must be >= ack' }, { status: 400 })
  }
  saveSla(body)
  appendAudit({ actor: auth.email, action: 'sla.update', resource: 'sla-config', success: true, details: { severities } })
  return NextResponse.json(loadSla())
}
