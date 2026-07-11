import { NextRequest, NextResponse } from 'next/server'
import { requireRole, getSessionFromRequest } from '@/lib/auth'
import { runBackup, runAllBackups } from '@/lib/backup-runner'
import { loadDatabases } from '@/lib/db-store'

const COLLECTOR_TOKEN = process.env.VYNDB_COLLECTOR_TOKEN ?? 'vyndb_collector_token_lab_2024'

async function checkAuth(req: NextRequest): Promise<boolean> {
  // Accept collector token OR a logged-in editor/admin session
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace('Bearer ', '').trim()
  if (token === COLLECTOR_TOKEN) return true
  const session = await getSessionFromRequest(req)
  return !!session && ['editor', 'admin'].includes(session.role)
}

export async function POST(req: NextRequest) {
  if (!await checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { dbId, type, path: customPath } = await req.json().catch(() => ({})) as { dbId?: string; type?: string; path?: string }
  const backupType = (['full', 'schema-only', 'data-only'].includes(type ?? '') ? type : 'full') as 'full' | 'schema-only' | 'data-only'

  if (dbId) {
    const db = loadDatabases().find(d => d.id === dbId)
    if (!db) return NextResponse.json({ error: 'DB not found' }, { status: 404 })
    const result = await runBackup(db, backupType, customPath || undefined)
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  }

  // Run all backups
  const results = await runAllBackups(backupType, customPath || undefined)
  const failed = results.filter(r => !r.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    total: results.length,
    succeeded: results.filter(r => r.ok).length,
    failed: failed.length,
    results,
  })
}
