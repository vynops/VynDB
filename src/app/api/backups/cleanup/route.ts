import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { cleanupOldBackups } from '@/lib/backup-runner'
import { getSettings } from '@/lib/settings-store'

const COLLECTOR_TOKEN = process.env.VYNDB_COLLECTOR_TOKEN ?? 'vyndb_collector_token_lab_2024'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace('Bearer ', '').trim()
  const session = await getSessionFromRequest(req)
  if (token !== COLLECTOR_TOKEN && (!session || !['editor', 'admin'].includes(session.role))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as { retentionDays?: number }
  const settings = getSettings()
  const retentionDays = body.retentionDays ?? settings.backupRetentionDays ?? 7

  const result = cleanupOldBackups(retentionDays)
  return NextResponse.json({ ok: true, retentionDays, ...result })
}
