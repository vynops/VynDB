import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadBackups } from '@/lib/db-store'
import { backupDiskStats } from '@/lib/backup-runner'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { searchParams } = new URL(req.url)
  if (searchParams.get('stats') === '1') {
    return NextResponse.json(backupDiskStats())
  }
  return NextResponse.json(loadBackups())
}
