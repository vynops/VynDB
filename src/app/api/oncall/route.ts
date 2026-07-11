import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadOncall, saveOncall } from '@/lib/incident-store'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadOncall())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const shifts = loadOncall()
  const shift = { id: crypto.randomUUID(), name: body.name ?? '', userEmail: body.userEmail, userName: body.userName ?? '', startTime: body.startTime, endTime: body.endTime, timezone: body.timezone ?? 'UTC' }
  shifts.push(shift)
  saveOncall(shifts)
  return NextResponse.json(shift, { status: 201 })
}
