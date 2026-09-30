import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { resolveRuleLock } from '@/lib/execution-claims'
import { appendAudit } from '@/lib/audit-store'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { note?: unknown; confirmed?: unknown }
  if (body.confirmed !== true || typeof body.note !== 'string' || body.note.trim().length < 20) {
    return NextResponse.json({ error: 'Confirm database inspection and provide a note of at least 20 characters' }, { status: 400 })
  }
  try {
    const resolved = resolveRuleLock(id, body.note.trim())
    if (!resolved) return NextResponse.json({ error: 'No active claim for this rule' }, { status: 404 })
    appendAudit({ actor: auth.email, action: 'automation.claim.resolve', resource: 'automation-rule', resourceId: id,
      success: true, details: { claimId: resolved.id, note: body.note.trim() } })
    return NextResponse.json({ ok: true, claimId: resolved.id })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cannot resolve claim' }, { status: 409 })
  }
}