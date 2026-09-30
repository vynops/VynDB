import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadCapacity, loadDatabases, STATUS_STALE_MS } from '@/lib/db-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const active = new Set(loadDatabases().filter(db => db.status === 'connected' || db.status === 'warning').map(db => db.id))
  const cutoff = Date.now() - STATUS_STALE_MS
  return NextResponse.json(loadCapacity().filter(item => active.has(item.dbId) && Date.parse(item.collectedAt ?? '') >= cutoff))
}
