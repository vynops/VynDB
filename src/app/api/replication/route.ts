import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases, loadReplication, STATUS_STALE_MS } from '@/lib/db-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const active = loadDatabases().filter(db => db.status === 'connected' || db.status === 'warning')
  const cutoff = Date.now() - STATUS_STALE_MS
  return NextResponse.json(loadReplication().filter(item =>
    Date.parse(item.collectedAt ?? '') >= cutoff && active.some(db => item.dbId === db.id || item.dbId.startsWith(`${db.id}-`))))
}
