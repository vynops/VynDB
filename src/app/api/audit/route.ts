import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadAuditLog } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit') ?? 100), 1), 1000)
  return NextResponse.json({ entries: loadAuditLog().slice(0, limit) })
}