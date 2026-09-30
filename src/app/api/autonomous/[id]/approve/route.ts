import { NextRequest, NextResponse } from 'next/server'
import { requireRole, getSessionFromRequest } from '@/lib/auth'
import { loadProposals, saveProposal, type AutonomousProposal } from '@/lib/automation-store'
import { loadDatabases } from '@/lib/db-store'
import { executeMaintenance } from '@/lib/maintenance-executor'
import { permittedMaintenanceSql } from '@/lib/maintenance-policy'
import { claimExecution, finishExecution } from '@/lib/execution-claims'
import { appendAudit } from '@/lib/audit-store'

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

  const db = loadDatabases().find(item => item.id === proposal.dbId)
  const permitted = db && db.engine === proposal.engine && permittedMaintenanceSql(db.engine, proposal.actionType, proposal.sql ?? '')
  const claim = permitted ? claimExecution(`proposal:${proposal.id}`) : null
  if (claim && !claim.claimed) {
    return NextResponse.json({ error: 'This proposal has already been attempted. Inspect its execution claim and database before retrying.', claim: claim.record }, { status: 409 })
  }
  const result = !db || db.engine !== proposal.engine
    ? { status: 'failed' as const, output: 'Database is missing or its engine has changed; no action was run.' }
    : await executeMaintenance(db, proposal.actionType, proposal.sql ?? '')
  if (claim) finishExecution(claim.record, result.status, result.status === 'unverified')
  const { output } = result
  const status: AutonomousProposal['status'] = result.status === 'verified' ? 'executed'
    : result.status === 'advisory' ? 'approved' : result.status
  const executedAt = status === 'executed' ? new Date().toISOString() : undefined
  const updated = {
    ...proposal,
    status,
    executedAt,
    executedBy: status === 'executed' ? session?.email ?? 'admin' : undefined,
    executionOutput: output,
  }
  saveProposal(updated)
  appendAudit({
    actor: session?.email ?? 'admin', action: status === 'approved' ? 'autonomous.review' : 'autonomous.execute', resource: 'proposal', resourceId: proposal.id,
    success: status === 'executed', details: { dbId: proposal.dbId, actionType: proposal.actionType, status, output: output.substring(0, 2000) },
  })

  return NextResponse.json({ ok: status === 'executed' || status === 'approved', status, output, executedAt }, { status: status === 'failed' || status === 'unverified' ? 422 : 200 })
}
