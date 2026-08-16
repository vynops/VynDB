import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRules, saveRule, deleteRule } from '@/lib/automation-store'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const rules = loadRules()
  const idx = rules.findIndex(r => r.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json() as { enabled?: boolean }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'Only enabled can be changed' }, { status: 400 })
  const updated = { ...rules[idx], enabled: body.enabled }
  saveRule(updated)
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  deleteRule(id)
  return NextResponse.json({ ok: true })
}
