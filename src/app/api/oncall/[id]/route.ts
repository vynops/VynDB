import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadOncall, saveOncall } from '@/lib/incident-store'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const filtered = loadOncall().filter(s => s.id !== id)
  saveOncall(filtered)
  return NextResponse.json({ ok: true })
}
