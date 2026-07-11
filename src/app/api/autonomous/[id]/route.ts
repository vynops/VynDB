import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadProposals, saveProposal } from '@/lib/automation-store'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const list = loadProposals()
  const idx = list.findIndex(p => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()
  const updated = { ...list[idx], ...body }
  saveProposal(updated)
  return NextResponse.json(updated)
}
