import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { patchIncident } from '@/lib/incident-store'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json()
  const updated = patchIncident(id, body)
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}
