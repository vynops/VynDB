import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadDatabases, STATUS_STALE_MS } from '@/lib/db-store'
import fs from 'fs'
import path from 'path'
import type { PerformanceSnapshot } from '@/lib/db-store'

function loadRealSnapshots(): PerformanceSnapshot[] {
  const p = path.join(process.cwd(), 'data', 'perf-snapshots.json')
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return [] }
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { searchParams } = new URL(req.url)
  const dbId = searchParams.get('dbId')
  const hours = parseInt(searchParams.get('hours') ?? '24')

  const realSnaps = loadRealSnapshots()

  if (!dbId) {
    const dbs = loadDatabases()
    const cutoff = Date.now() - STATUS_STALE_MS
    return NextResponse.json(dbs.flatMap(d => {
      if (d.status !== 'connected' && d.status !== 'warning') return []
      const latest = realSnaps.filter(s => s.dbId === d.id && Date.parse(s.timestamp) >= cutoff)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
      return latest ? [{ ...latest, name: d.name, dataQuality: 'real', source: 'collector' }] : []
    }))
  }

  // Filter real snapshots for this DB within the time window
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString()
  const filtered = realSnaps.filter(s => s.dbId === dbId && s.timestamp >= cutoff)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  return NextResponse.json(filtered.map(snapshot => ({ ...snapshot, dataQuality: 'real', source: 'collector' })))
}
