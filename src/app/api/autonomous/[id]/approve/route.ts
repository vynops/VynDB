import { NextRequest, NextResponse } from 'next/server'
import { requireRole, getSessionFromRequest } from '@/lib/auth'
import { loadProposals, saveProposal } from '@/lib/automation-store'
import { loadDatabases } from '@/lib/db-store'
import { getPgPool, getMysqlPool, getMongoClient } from '@/lib/db-connections'
import { appendAudit } from '@/lib/audit-store'

const TIMEOUT_MS = 60_000

async function executeProposal(
  engine: string, dbId: string, sql: string, actionType: string, proposedAction: string, dbName: string
): Promise<string> {
  const db = loadDatabases().find(d => d.id === dbId)

  if (!db) return `[Error] Database ${dbName} not found in connections`

  // If no SQL provided or action is advisory-only, fall back to descriptive output
  if (!sql || actionType === 'custom') {
    const diagSql = sql?.trim()
    if (!diagSql || diagSql.startsWith('--')) {
      return `[Advisory] No executable SQL — manual action required:\n${proposedAction}`
    }
  }

  const t0 = Date.now()

  try {
    if (engine === 'postgresql') {
      const pool = await getPgPool(db)
      if (!pool) return `[Error] Cannot connect to ${dbName}`

      const statements = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'))
      const outputs: string[] = []

      for (const stmt of statements) {
        const result = await Promise.race([
          pool.query(stmt),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Query timed out')), TIMEOUT_MS)),
        ])
        const rows = result.rows ?? []
        const ms = Date.now() - t0
        if (rows.length > 0) {
          const cols = Object.keys(rows[0])
          const preview = rows.slice(0, 5).map(r => cols.map(c => `${c}=${r[c]}`).join(', ')).join('\n')
          outputs.push(`${stmt.substring(0, 60)}...\n${rows.length} rows in ${ms}ms:\n${preview}`)
        } else {
          outputs.push(`${stmt.substring(0, 60)}\nCompleted in ${ms}ms | rowCount: ${result.rowCount ?? 0}`)
        }
      }
      return outputs.join('\n\n') || `Executed on ${dbName} in ${Date.now() - t0}ms`
    }

    if (engine === 'mysql') {
      const pool = await getMysqlPool(db)
      if (!pool) return `[Error] Cannot connect to ${dbName}`
      const [rows] = await Promise.race([
        pool.execute(sql),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Query timed out')), TIMEOUT_MS)),
      ]) as [unknown[], unknown]
      const ms = Date.now() - t0
      const rowArr = rows as Record<string, unknown>[]
      return rowArr.length > 0
        ? `${rowArr.length} rows in ${ms}ms:\n${JSON.stringify(rowArr.slice(0, 3), null, 2)}`
        : `Completed in ${ms}ms`
    }

    if (engine === 'mongodb') {
      const client = await getMongoClient(db)
      if (!client) return `[Error] Cannot connect to ${dbName}`
      const result = await client.db(db.database).command({ eval: sql })
      return `Executed on ${dbName} in ${Date.now() - t0}ms:\n${JSON.stringify(result, null, 2).substring(0, 500)}`
    }

    return `[Info] Engine '${engine}' — manual execution required:\n${proposedAction}`
  } catch (e) {
    return `[Error] ${(e as Error).message}`
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const session = await getSessionFromRequest(req)
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean; confirm?: boolean }

  const list = loadProposals()
  const idx = list.findIndex(p => p.id === id)
  if (idx === -1) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const proposal = list[idx]
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: `Proposal is already ${proposal.status}` }, { status: 400 })
  }

  if (!body.dryRun && body.confirm !== true) {
    return NextResponse.json({ error: 'Explicit confirmation is required to execute a proposal' }, { status: 400 })
  }

  if (body.dryRun) {
    appendAudit({
      actor: session?.email ?? 'admin', action: 'autonomous.dry_run', resource: 'proposal', resourceId: proposal.id,
      success: true, details: { dbId: proposal.dbId, actionType: proposal.actionType, sql: proposal.sql ?? null },
    })
    return NextResponse.json({ ok: true, dryRun: true, proposal })
  }

  const output = await executeProposal(
    proposal.engine, proposal.dbId,
    proposal.sql ?? '', proposal.actionType,
    proposal.proposedAction, proposal.dbName
  )

  const executedAt = new Date().toISOString()
  const updated = {
    ...proposal,
    status: 'executed' as const,
    executedAt,
    executedBy: session?.email ?? 'admin',
    executionOutput: output,
  }
  saveProposal(updated)
  appendAudit({
    actor: session?.email ?? 'admin', action: 'autonomous.execute', resource: 'proposal', resourceId: proposal.id,
    success: !output.startsWith('[Error]'), details: { dbId: proposal.dbId, actionType: proposal.actionType, output: output.substring(0, 2000) },
  })

  return NextResponse.json({ ok: true, output, executedAt })
}
