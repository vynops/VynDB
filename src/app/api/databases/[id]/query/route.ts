import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases } from '@/lib/db-store'
import { getPgPool, getMysqlPool, getMongoClient, getRedisClient, getMssqlPool } from '@/lib/db-connections'

const MAX_ROWS = 500
const TIMEOUT_MS = 30_000

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const dbs = loadDatabases()
  const db = dbs.find(d => d.id === id)
  if (!db) return NextResponse.json({ error: 'Database not found' }, { status: 404 })

  const body = await req.json() as { sql?: string; limit?: number }
  const sql = (body.sql ?? '').trim()
  if (!sql) return NextResponse.json({ error: 'No query provided' }, { status: 400 })

  const limit = Math.min(body.limit ?? MAX_ROWS, MAX_ROWS)
  const t0 = Date.now()

  try {
    switch (db.engine) {
      case 'postgresql': {
        const pool = await getPgPool(db)
        if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
        const result = await Promise.race([
          pool.query(sql),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Query timed out')), TIMEOUT_MS)),
        ])
        const rows = result.rows.slice(0, limit)
        const columns = result.fields?.map((f: { name: string }) => f.name) ?? Object.keys(rows[0] ?? {})
        return NextResponse.json({
          columns,
          rows: rows.map(r => columns.map((c: string) => r[c] ?? null)),
          rowCount: result.rowCount ?? rows.length,
          durationMs: Date.now() - t0,
        })
      }

      case 'mysql': {
        const pool = await getMysqlPool(db)
        if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
        const [rawRows, fields] = await Promise.race([
          pool.execute(sql),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Query timed out')), TIMEOUT_MS)),
        ]) as [Record<string, unknown>[], { name: string }[]]
        const rows = (rawRows as Record<string, unknown>[]).slice(0, limit)
        const columns = fields?.map(f => f.name) ?? Object.keys(rows[0] ?? {})
        return NextResponse.json({
          columns,
          rows: rows.map(r => columns.map((c: string) => {
            const v = r[c]
            return v instanceof Date ? v.toISOString() : v ?? null
          })),
          rowCount: rows.length,
          durationMs: Date.now() - t0,
        })
      }

      case 'mongodb': {
        const client = await getMongoClient(db)
        if (!client) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })

        // Parse simple find/aggregate patterns or run as command
        let result: Record<string, unknown>[]
        try {
          // Try evaluating as a JS-style mongo query
          // Support: db.collection.find({...}), db.collection.aggregate([...])
          const mdb = client.db(db.database)
          const findMatch = sql.match(/^db\.(\w+)\.find\s*\(([\s\S]*?)\)(?:\.limit\(\d+\))?$/i)
          const aggMatch  = sql.match(/^db\.(\w+)\.aggregate\s*\(([\s\S]*)\)$/i)
          const countMatch = sql.match(/^db\.(\w+)\.countDocuments\s*\(([\s\S]*?)\)$/i)

          if (findMatch) {
            // eslint-disable-next-line no-eval
            const filter = findMatch[2].trim() ? eval(`(${findMatch[2]})`) : {}
            result = await mdb.collection(findMatch[1]).find(filter).limit(limit).toArray() as Record<string, unknown>[]
          } else if (aggMatch) {
            // eslint-disable-next-line no-eval
            const pipeline = eval(`(${aggMatch[1]})`)
            result = await mdb.collection(aggMatch[1]).aggregate(pipeline).limit(limit).toArray() as Record<string, unknown>[]
          } else if (countMatch) {
            // eslint-disable-next-line no-eval
            const filter = countMatch[2].trim() ? eval(`(${countMatch[2]})`) : {}
            const count = await mdb.collection(countMatch[1]).countDocuments(filter)
            return NextResponse.json({ columns: ['count'], rows: [[count]], rowCount: 1, durationMs: Date.now() - t0 })
          } else {
            // Try as a raw admin command (e.g. db.runCommand({...}))
            // eslint-disable-next-line no-eval
            const cmd = eval(`(${sql.replace(/^db\.runCommand\s*\(/, '').replace(/\)\s*$/, '')})`)
            const res = await mdb.command(cmd)
            result = [res as Record<string, unknown>]
          }
        } catch (e) {
          return NextResponse.json({ error: `MongoDB query error: ${(e as Error).message}` }, { status: 400 })
        }

        if (result.length === 0) return NextResponse.json({ columns: [], rows: [], rowCount: 0, durationMs: Date.now() - t0 })
        const columns = Object.keys(result[0])
        return NextResponse.json({
          columns,
          rows: result.map(r => columns.map(c => {
            const v = r[c]
            return v && typeof v === 'object' ? JSON.stringify(v) : v ?? null
          })),
          rowCount: result.length,
          durationMs: Date.now() - t0,
        })
      }

      case 'redis': {
        const redis = await getRedisClient(db)
        if (!redis) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
        const parts = sql.trim().split(/\s+/)
        const cmd = parts[0].toLowerCase()
        const args = parts.slice(1).map(a => a.replace(/^['"]|['"]$/g, ''))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await (redis as any).call(cmd, ...args)
        const output = Array.isArray(raw) ? raw : [raw]
        return NextResponse.json({
          columns: ['result'],
          rows: output.map(v => [v === null ? '(nil)' : String(v)]),
          rowCount: output.length,
          durationMs: Date.now() - t0,
        })
      }

      default:
        // SQL Server
        if (db.engine === 'sqlserver') {
          const pool = await getMssqlPool(db)
          if (!pool) return NextResponse.json({ error: 'Cannot connect to database' }, { status: 503 })
          const result = await Promise.race([
            pool.request().query(sql),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Query timed out')), TIMEOUT_MS)),
          ])
          const rows = (result.recordset ?? []).slice(0, limit)
          const columns = rows.length > 0 ? Object.keys(rows[0]) : []
          return NextResponse.json({
            columns,
            rows: rows.map((r: Record<string, unknown>) => columns.map(c => {
              const v = r[c]
              return v instanceof Date ? v.toISOString() : v ?? null
            })),
            rowCount: result.rowsAffected?.[0] ?? rows.length,
            durationMs: Date.now() - t0,
          })
        }
        return NextResponse.json({ error: `Engine '${db.engine}' query console not supported` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
