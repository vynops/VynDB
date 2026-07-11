import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSecurity, saveSecurityFinding } from '@/lib/db-store'

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
  return NextResponse.json(list[idx])
}
