import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases, saveDatabase, SUPPORTED_DB_ENGINES } from '@/lib/db-store'
import crypto from 'crypto'
import { appendAudit } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadDatabases())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  if (typeof body.engine !== 'string' || !SUPPORTED_DB_ENGINES.includes(body.engine)) {
    return NextResponse.json({ error: 'Unsupported database engine' }, { status: 400 })
  }
  const db = {
    id: `db-${crypto.randomUUID().slice(0, 8)}`,
    name: body.name, engine: body.engine, host: body.host,
    port: body.port, database: body.database, username: body.username,
    passwordEnc: body.password ?? '', ssl: body.ssl ?? false,
    environment: body.environment ?? 'development', status: 'unknown' as const,
    healthScore: 0, lastChecked: new Date().toISOString(),
    notes: body.notes ?? '', createdAt: new Date().toISOString(),
    version: undefined,
  }
  saveDatabase(db)
  appendAudit({ actor: auth.email, action: 'database.create', resource: 'database', resourceId: db.id, success: true, details: { name: db.name, engine: db.engine, host: db.host } })
  return NextResponse.json(db, { status: 201 })
}
