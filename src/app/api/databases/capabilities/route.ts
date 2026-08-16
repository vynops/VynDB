import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabaseCapabilities } from '@/lib/database-capabilities'
import { loadDatabases } from '@/lib/db-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth

  const result = loadDatabases().map(db => ({
    dbId: db.id,
    dbName: db.name,
    engine: db.engine,
    capabilities: getDatabaseCapabilities(db.engine),
  }))
  return NextResponse.json(result)
}