import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases } from '@/lib/db-store'
import { getPgPool, getMysqlPool } from '@/lib/db-connections'

function isReadOnlyQuery(sql: string): boolean {
  return /^(select|with)\b/i.test(sql.trim()) && !/[;]\s*\S/.test(sql.trim())
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const db = loadDatabases().find(item => item.id === id)
  if (!db) return NextResponse.json({ error: 'Database not found' }, { status: 404 })
  const body = await req.json() as { sql?: string }
  const sql = body.sql?.trim() ?? ''
  if (!sql || !isReadOnlyQuery(sql)) {
    return NextResponse.json({ error: 'Only one read-only SELECT or WITH query can be explained' }, { status: 400 })
  }

  try {
    if (db.engine === 'postgresql') {
      const pool = await getPgPool(db)
      if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const result = await pool.query(`EXPLAIN (FORMAT JSON, COSTS true, BUFFERS false) ${sql}`)
      return NextResponse.json({ dbId: db.id, engine: db.engine, plan: result.rows[0]?.['QUERY PLAN'] ?? result.rows, dataQuality: 'real' })
    }
    if (db.engine === 'mysql') {
      const pool = await getMysqlPool(db)
      if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
      const [rows] = await pool.query(`EXPLAIN FORMAT=JSON ${sql}`)
      return NextResponse.json({ dbId: db.id, engine: db.engine, plan: rows, dataQuality: 'real' })
    }
    return NextResponse.json({ dbId: db.id, engine: db.engine, plan: null, dataQuality: 'unavailable', message: 'Execution-plan collection is not implemented for this engine yet.' }, { status: 422 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 })
  }
}