import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSecurity, saveSecurityFinding } from '@/lib/db-store'
import { appendAudit } from '@/lib/audit-store'
import { getSessionFromRequest } from '@/lib/auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const list = loadSecurity()
  const idx = list.findIndex(f => f.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()
  list[idx] = { ...list[idx], ...body }
  saveSecurityFinding(list[idx])
  const session = await getSessionFromRequest(req)
  appendAudit({ actor: session?.email ?? 'unknown', action: 'security-finding.update', resource: 'security-finding', resourceId: id, success: true, details: { fields: Object.keys(body) } })
  return NextResponse.json(list[idx])
}
