import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { BackupType } from './backup-runner'

const DATA_DIR = path.join(process.cwd(), 'data')
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }) }
function load<T>(file: string, def: T): T {
  ensureDir(); const p = path.join(DATA_DIR, file)
  if (!fs.existsSync(p)) return def
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return def }
}
function save(file: string, data: unknown) {
  ensureDir(); fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8')
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface BackupSchedule {
  id: string
  dbId: string
  dbName: string
  engine: string
  cronExpr: string
  cronLabel: string
  backupType: BackupType
  location: string       // absolute path or '' for default
  retentionDays: number  // 0 = use global setting
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: 'succeeded' | 'failed'
  lastRunOutput?: string
  nextRunAt?: string
  createdAt: string
}

export const CRON_PRESETS: { label: string; expr: string }[] = [
  { label: 'Every 30 min',     expr: '*/30 * * * *' },
  { label: 'Every hour',       expr: '0 * * * *'    },
  { label: 'Every 6 hours',    expr: '0 */6 * * *'  },
  { label: 'Every 12 hours',   expr: '0 */12 * * *' },
  { label: 'Daily 01:00 UTC',  expr: '0 1 * * *'    },
  { label: 'Daily 02:00 UTC',  expr: '0 2 * * *'    },
  { label: 'Daily 03:00 UTC',  expr: '0 3 * * *'    },
  { label: 'Daily 04:00 UTC',  expr: '0 4 * * *'    },
  { label: 'Weekly Sun 02:00', expr: '0 2 * * 0'    },
  { label: 'Weekly Mon 02:00', expr: '0 2 * * 1'    },
  { label: 'Monthly 1st 02:00',expr: '0 2 1 * *'    },
]

// ── Demo seed data ─────────────────────────────────────────────────────────

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const DEMO_SCHEDULES: BackupSchedule[] = [
  {
    id: 'sched-001', dbId: 'db-lab-pg-primary', dbName: 'labdb-postgres', engine: 'postgresql',
    cronExpr: '0 2 * * *', cronLabel: 'Daily 02:00 UTC',
    backupType: 'full', location: '', retentionDays: 7, enabled: true,
    lastRunAt: hoursAgo(22), lastRunStatus: 'succeeded',
    nextRunAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    createdAt: hoursAgo(168),
  },
  {
    id: 'sched-002', dbId: 'db-lab-mysql', dbName: 'labdb-mysql', engine: 'mysql',
    cronExpr: '0 3 * * *', cronLabel: 'Daily 03:00 UTC',
    backupType: 'full', location: '', retentionDays: 7, enabled: true,
    lastRunAt: hoursAgo(21), lastRunStatus: 'succeeded',
    nextRunAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    createdAt: hoursAgo(168),
  },
  {
    id: 'sched-003', dbId: 'db-lab-mongodb', dbName: 'labdb-mongodb', engine: 'mongodb',
    cronExpr: '0 2 * * 0', cronLabel: 'Weekly Sun 02:00 UTC',
    backupType: 'full', location: '', retentionDays: 30, enabled: true,
    lastRunAt: hoursAgo(72), lastRunStatus: 'succeeded',
    nextRunAt: new Date(Date.now() + 4 * 24 * 3_600_000).toISOString(),
    createdAt: hoursAgo(168),
  },
  {
    id: 'sched-004', dbId: 'db-lab-redis', dbName: 'labdb-redis', engine: 'redis',
    cronExpr: '0 */6 * * *', cronLabel: 'Every 6 hours',
    backupType: 'full', location: '', retentionDays: 3, enabled: true,
    lastRunAt: hoursAgo(2), lastRunStatus: 'succeeded',
    nextRunAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    createdAt: hoursAgo(168),
  },
]

// ── Store helpers ──────────────────────────────────────────────────────────

export function loadSchedules(): BackupSchedule[] {
  return load('backup-schedules.json', DEMO_SCHEDULES)
}

export function saveSchedule(s: BackupSchedule): void {
  const list = loadSchedules()
  const idx = list.findIndex(x => x.id === s.id)
  if (idx === -1) { list.unshift(s) } else { list[idx] = s }
  save('backup-schedules.json', list)
}

export function deleteSchedule(id: string): void {
  save('backup-schedules.json', loadSchedules().filter(s => s.id !== id))
}

export function newScheduleId(): string {
  return `sched-${crypto.randomUUID().slice(0, 8)}`
}

// ── Cron helpers ───────────────────────────────────────────────────────────

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true
  if (field.startsWith('*/')) return value % parseInt(field.slice(2)) === 0
  if (field.includes(',')) return field.split(',').some(f => parseInt(f.trim()) === value)
  if (field.includes('-')) {
    const [a, b] = field.split('-').map(Number)
    return value >= a && value <= b
  }
  return parseInt(field) === value
}

/** Returns true if the cron expression is due to run at `now` (within a 5-min window). */
export function cronIsDue(expr: string, now: Date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minF, hourF, domF, monF, dowF] = parts

  const min = now.getUTCMinutes()
  // Allow ±4 min window for the minute field (trigger fires every 5 min)
  let minuteOk = false
  if (minF === '*') {
    minuteOk = true
  } else if (minF.startsWith('*/')) {
    const step = parseInt(minF.slice(2))
    for (let m = Math.max(0, min - 4); m <= min; m++) {
      if (m % step === 0) { minuteOk = true; break }
    }
  } else {
    const target = parseInt(minF)
    minuteOk = target >= min - 4 && target <= min
  }

  return minuteOk &&
    fieldMatches(hourF, now.getUTCHours()) &&
    fieldMatches(domF, now.getUTCDate()) &&
    fieldMatches(monF, now.getUTCMonth() + 1) &&
    fieldMatches(dowF, now.getUTCDay())
}

/** Compute next occurrence of a cron expression after `from`. Iterates minute-by-minute, up to 8 days. */
export function computeNextRun(expr: string, from: Date = new Date()): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return new Date(from.getTime() + 86_400_000).toISOString()

  const [minF, hourF, domF, monF, dowF] = parts
  const cursor = new Date(from)
  cursor.setUTCSeconds(0, 0)
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1) // start 1 min in future

  for (let i = 0; i < 8 * 24 * 60; i++) {
    if (fieldMatches(minF,  cursor.getUTCMinutes()) &&
        fieldMatches(hourF, cursor.getUTCHours()) &&
        fieldMatches(domF,  cursor.getUTCDate()) &&
        fieldMatches(monF,  cursor.getUTCMonth() + 1) &&
        fieldMatches(dowF,  cursor.getUTCDay())) {
      return cursor.toISOString()
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
  }
  return new Date(from.getTime() + 86_400_000).toISOString()
}
