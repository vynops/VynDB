import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadOncall, saveOncall } from '@/lib/incident-store'
import crypto from 'crypto'
import { appendAudit } from '@/lib/audit-store'

const VALID_TIMEZONES = new Set(['UTC', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'])

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadOncall())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const email = String(body.userEmail ?? '').trim()
  const start = new Date(body.startTime)
  const end = new Date(body.endTime)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || !VALID_TIMEZONES.has(body.timezone ?? 'UTC')) {
    return NextResponse.json({ error: 'Valid email, dates, timezone, and an end time after start are required' }, { status: 400 })
  }
  const shifts = loadOncall()
  if (shifts.some(s => new Date(s.startTime) < end && new Date(s.endTime) > start)) return NextResponse.json({ error: 'Shift overlaps an existing shift' }, { status: 409 })
  const shift = { id: crypto.randomUUID(), name: String(body.name ?? ''), userEmail: email, userName: String(body.userName ?? ''), startTime: start.toISOString(), endTime: end.toISOString(), timezone: body.timezone ?? 'UTC' }
  shifts.push(shift)
  saveOncall(shifts)
  appendAudit({ actor: auth.email, action: 'oncall.create', resource: 'shift', resourceId: shift.id, success: true, details: { email, startTime: shift.startTime, endTime: shift.endTime } })
  return NextResponse.json(shift, { status: 201 })
}
