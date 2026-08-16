import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth'
import { loadSchedules, saveSchedule, cronIsDue, computeNextRun } from '@/lib/backup-schedule-store'
import { runBackup } from '@/lib/backup-runner'
import { loadDatabases } from '@/lib/db-store'
import { cleanupOldBackups } from '@/lib/backup-runner'
import { getSettings } from '@/lib/settings-store'

const COLLECTOR_TOKEN = process.env.VYNDB_COLLECTOR_TOKEN ?? 'vyndb_collector_token_lab_2024'

export async function POST(req: NextRequest) {
  const auth    = req.headers.get('authorization') ?? ''
  const token   = auth.replace('Bearer ', '').trim()
  const session = await getSessionFromRequest(req)
  if (token !== COLLECTOR_TOKEN && (!session || !['editor', 'admin'].includes(session.role))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const schedules = loadSchedules()
  const dbs       = loadDatabases()
  const now       = new Date()
  const results: Array<{ scheduleId: string; dbName: string; ok: boolean; skipped?: boolean; reason?: string }> = []

  for (const sched of schedules) {
    if (!sched.enabled) continue

    // Skip if already ran within the last 5 minutes (prevent double-fire)
    if (sched.lastRunAt) {
      const msSinceLastRun = now.getTime() - new Date(sched.lastRunAt).getTime()
      if (msSinceLastRun < 4 * 60 * 1000) {
        results.push({ scheduleId: sched.id, dbName: sched.dbName, ok: true, skipped: true, reason: 'ran recently' })
        continue
      }
    }

    if (!cronIsDue(sched.cronExpr, now)) continue

    // Find the DB connection
    const db = dbs.find(d => d.id === sched.dbId)
    if (!db) {
      results.push({ scheduleId: sched.id, dbName: sched.dbName, ok: false, reason: 'DB not found in connections' })
      continue
    }

    // Run backup
    const globalPath = getSettings().backupPath || undefined
    const result = await runBackup(db, sched.backupType, sched.location || globalPath)

    // Update schedule with run result
    const nextRun = computeNextRun(sched.cronExpr, now)
    saveSchedule({
      ...sched,
      lastRunAt: now.toISOString(),
      lastRunStatus: result.ok ? 'succeeded' : 'failed',
      lastRunOutput: result.job.error ?? (result.ok ? `${result.job.sizeMB} MB backup succeeded` : 'failed'),
      nextRunAt: nextRun,
    })

    // Auto-cleanup with schedule's retention (or global)
    const retention = sched.retentionDays > 0 ? sched.retentionDays : (getSettings().backupRetentionDays ?? 7)
    cleanupOldBackups(retention)

    results.push({ scheduleId: sched.id, dbName: sched.dbName, ok: result.ok })
  }

  const fired    = results.filter(r => !r.skipped)
  const executed = fired.filter(r => r.ok).length
  const failed   = fired.filter(r => !r.ok).length

  return NextResponse.json({ ok: failed === 0, executed, failed, skipped: results.filter(r => r.skipped).length, results })
}
