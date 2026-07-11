import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRouting, saveRouting } from '@/lib/incident-store'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json()
  const rules = loadRouting()
  const idx = rules.findIndex(r => r.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  rules[idx] = { ...rules[idx], ...body, id }
  saveRouting(rules)
  return NextResponse.json(rules[idx])
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const filtered = loadRouting().filter(r => r.id !== id)
  saveRouting(filtered)
  return NextResponse.json({ ok: true })
}
