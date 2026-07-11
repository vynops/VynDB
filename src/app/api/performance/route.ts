import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { generatePerformanceHistory, loadDatabases } from '@/lib/db-store'
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
    return NextResponse.json(dbs.map(d => {
      const real = realSnaps.filter(s => s.dbId === d.id)
      const snap = real.length > 0 ? real[0] : generatePerformanceHistory(d.id, 1).slice(-1)[0]
      return { ...snap, dbId: d.id, name: d.name }
    }))
  }

  // Filter real snapshots for this DB within the time window
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString()
  const filtered = realSnaps.filter(s => s.dbId === dbId && s.timestamp >= cutoff)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  // Fall back to generated data if no real snapshots exist yet
  if (filtered.length === 0) return NextResponse.json(generatePerformanceHistory(dbId, hours))
  return NextResponse.json(filtered)
}
