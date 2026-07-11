import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases, saveDatabase } from '@/lib/db-store'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadDatabases())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
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
  return NextResponse.json(db, { status: 201 })
}
