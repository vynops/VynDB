import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases, saveDatabase, deleteDatabase } from '@/lib/db-store'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const db = loadDatabases().find(d => d.id === id)
  if (!db) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(db)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const list = loadDatabases()
  const idx = list.findIndex(d => d.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = await req.json()
  const updated = {
    ...list[idx],
    name: body.name ?? list[idx].name,
    engine: body.engine ?? list[idx].engine,
    host: body.host ?? list[idx].host,
    port: body.port ?? list[idx].port,
    database: body.database ?? list[idx].database,
    username: body.username ?? list[idx].username,
    passwordEnc: body.password || list[idx].passwordEnc,
    ssl: body.ssl ?? list[idx].ssl,
    environment: body.environment ?? list[idx].environment,
    notes: body.notes ?? list[idx].notes,
  }
  saveDatabase(updated)
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  deleteDatabase(id)
  return NextResponse.json({ ok: true })
}
