import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { testConnection } from '@/lib/db-connections'
import type { DbConnection } from '@/lib/db-store'

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json() as Partial<DbConnection> & { password?: string }

  if (!body.host) return NextResponse.json({ ok: false, message: 'Host is required' }, { status: 400 })

  // Build a temporary connection object for testing
  const tempDb: DbConnection = {
    id: `test-${Date.now()}`,
    name: body.name ?? 'test',
    engine: body.engine ?? 'postgresql',
    host: body.host,
    port: body.port ?? 5432,
    database: body.database ?? '',
    username: body.username ?? '',
    passwordEnc: body.password ?? body.passwordEnc ?? '',
    ssl: body.ssl ?? false,
    environment: body.environment ?? 'development',
    status: 'unknown', healthScore: 0,
    lastChecked: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }

  const result = await testConnection(tempDb)
  return NextResponse.json(result)
}
