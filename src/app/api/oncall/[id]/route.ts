import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadOncall, saveOncall } from '@/lib/incident-store'
import { appendAudit } from '@/lib/audit-store'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const filtered = loadOncall().filter(s => s.id !== id)
  if (filtered.length === loadOncall().length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  saveOncall(filtered)
  appendAudit({ actor: auth.email, action: 'oncall.delete', resource: 'shift', resourceId: id, success: true })
  return NextResponse.json({ ok: true })
}
