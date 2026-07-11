import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSchedules, saveSchedule, deleteSchedule, computeNextRun } from '@/lib/backup-schedule-store'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const list = loadSchedules()
  const idx  = list.findIndex(s => s.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body    = await req.json()
  const updated = {
    ...list[idx], ...body,
    nextRunAt: computeNextRun(body.cronExpr ?? list[idx].cronExpr),
  }
  saveSchedule(updated)
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  deleteSchedule(id)
  return NextResponse.json({ ok: true })
}
