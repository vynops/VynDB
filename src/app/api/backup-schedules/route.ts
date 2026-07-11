import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadSchedules, saveSchedule, newScheduleId, computeNextRun } from '@/lib/backup-schedule-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadSchedules())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const schedule = {
    id: newScheduleId(),
    dbId: body.dbId, dbName: body.dbName, engine: body.engine,
    cronExpr: body.cronExpr, cronLabel: body.cronLabel,
    backupType: body.backupType ?? 'full',
    location: body.location ?? '',
    retentionDays: body.retentionDays ?? 0,
    enabled: body.enabled ?? true,
    nextRunAt: computeNextRun(body.cronExpr),
    createdAt: new Date().toISOString(),
  }
  saveSchedule(schedule)
  return NextResponse.json(schedule, { status: 201 })
}
