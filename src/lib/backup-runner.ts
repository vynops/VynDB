/**
 * VynDB Backup Runner
 * Executes real backups via `docker exec` against the lab containers.
 * Requires: vyndb user is in the `docker` group on the server.
 */

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { loadDatabases, saveBackup, loadBackups, type BackupJob, type DbConnection } from './db-store'

const BACKUP_DIR = path.join(process.cwd(), 'backups')

// Map db id → docker container name
const CONTAINER_MAP: Record<string, string> = {
  'db-lab-pg-primary': 'labdb-pg-primary',
  'db-lab-pg-replica': 'labdb-pg-primary', // backup from primary, not replica
  'db-lab-mysql':      'labdb-mysql',
  'db-lab-mongodb':    'labdb-mongodb',
  'db-lab-redis':      'labdb-redis',
  'db-lab-sqlserver':  'labdb-sqlserver',
}

function ensureBackupDir(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function fileSizeMB(filePath: string): number {
  try { return Math.round(fs.statSync(filePath).size / 1024 / 1024 * 100) / 100 }
  catch { return 0 }
}

// Run a docker command — uses sg to ensure docker group is active
function dockerExec(cmd: string, opts: { timeout?: number } = {}): string {
  return execSync(`sg docker -c '${cmd.replace(/'/g, "'\\''")}'`, {
    shell: '/bin/bash',
    timeout: opts.timeout ?? 120000,
  }).toString()
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export type BackupType = 'full' | 'schema-only' | 'data-only'

export interface BackupRunResult {
  ok: boolean
  job: BackupJob
  error?: string
}

export async function runBackup(db: DbConnection, backupType: BackupType = 'full', customPath?: string): Promise<BackupRunResult> {
  const targetDir = customPath || BACKUP_DIR
  ensureBackupDir(targetDir)

  const container = CONTAINER_MAP[db.id]
  if (!container) {
    return {
      ok: false,
      job: makeJob(db, 'failed', 0, '', 'No container mapping for this DB'),
      error: `No container mapping for DB id: ${db.id}`,
    }
  }

  const ts = stamp()
  const startedAt = new Date().toISOString()
  let backupFile = ''
  let sizeMB = 0

  try {
    switch (db.engine) {
      // ── PostgreSQL ────────────────────────────────────────────────────────
      case 'postgresql': {
        const ext = backupType === 'full' ? 'dump' : 'sql'
        backupFile = path.join(targetDir, `pg-${db.name}-${backupType}-${ts}.${ext}`)
        const typeFlag = backupType === 'schema-only' ? '--schema-only' : backupType === 'data-only' ? '--data-only' : ''
        const fmtFlag  = backupType === 'full' ? '-Fc' : '-Fp'
        dockerExec(`docker exec ${container} pg_dump -U ${db.username} ${fmtFlag} ${typeFlag} ${db.database} > '${backupFile}'`)
        sizeMB = fileSizeMB(backupFile)
        break
      }

      // ── MySQL ─────────────────────────────────────────────────────────────
      case 'mysql': {
        backupFile = path.join(targetDir, `mysql-${db.name}-${backupType}-${ts}.sql.gz`)
        const mysqlFlags = backupType === 'schema-only' ? '--no-data' : backupType === 'data-only' ? '--no-create-info' : '--single-transaction --quick'
        dockerExec(`docker exec ${container} mysqldump -u ${db.username} -p'${db.passwordEnc}' ${mysqlFlags} ${db.database} | gzip > '${backupFile}'`)
        sizeMB = fileSizeMB(backupFile)
        break
      }

      // ── MongoDB ───────────────────────────────────────────────────────────
      case 'mongodb': {
        backupFile = path.join(targetDir, `mongo-${db.name}-${ts}.archive.gz`)
        const encodedPass = encodeURIComponent(db.passwordEnc)
        // Use dedicated backup user (simple password, no special chars — avoids shell quoting issues)
        // The 'backup' user is created during lab setup with read-only access
        dockerExec(
          `docker exec ${container} mongodump -u backup -p backup123 ` +
          `--host 127.0.0.1 --port 27017 --db ${db.database} --authenticationDatabase ${db.database} ` +
          `--archive --gzip > '${backupFile}'`
        )
        sizeMB = fileSizeMB(backupFile)
        break
      }

      // ── Redis ─────────────────────────────────────────────────────────────
      case 'redis': {
        backupFile = path.join(targetDir, `redis-${db.name}-${ts}.rdb`)
        // Trigger BGSAVE and wait for it to complete
        dockerExec(`docker exec ${container} redis-cli BGSAVE`, { timeout: 10000 })
        // Wait for BGSAVE to finish (poll for up to 30s)
        let saved = false
        for (let i = 0; i < 15; i++) {
          const status = dockerExec(`docker exec ${container} redis-cli LASTSAVE`, { timeout: 5000 }).trim()
          const lastSave = parseInt(status)
          if (lastSave > Date.now() / 1000 - 60) { saved = true; break }
          execSync('sleep 2')
        }
        if (saved) {
          dockerExec(`docker cp ${container}:/data/dump.rdb '${backupFile}'`, { timeout: 30000 })
          sizeMB = fileSizeMB(backupFile)
        }
        break
      }

      // ── SQL Server ────────────────────────────────────────────────────────
      case 'sqlserver': {
        backupFile = path.join(targetDir, `mssql-${db.name}-${backupType}-${ts}.bak`)
        const sqlType = backupType === 'schema-only' ? 'DATABASE' : backupType === 'data-only' ? 'DATABASE' : 'DATABASE'
        dockerExec(
          `docker exec ${container} /opt/mssql-tools18/bin/sqlcmd ` +
          `-S localhost -U ${db.username} -P '${db.passwordEnc}' -No ` +
          `-Q "BACKUP ${sqlType} [${db.database}] TO DISK = '/var/opt/mssql/backup.bak' WITH FORMAT, INIT, NAME='VynDB backup';" ` +
          `&& docker cp ${container}:/var/opt/mssql/backup.bak '${backupFile}'`
        )
        sizeMB = fileSizeMB(backupFile)
        break
      }

      default:
        return {
          ok: false,
          job: makeJob(db, 'failed', 0, '', `Engine '${db.engine}' backup not supported`),
          error: `Unsupported engine: ${db.engine}`,
        }
    }

    const job = makeJob(db, 'succeeded', sizeMB, backupFile, undefined, startedAt, backupType)
    saveBackup(job)
    return { ok: true, job }

  } catch (e) {
    const errMsg = (e as Error).message ?? String(e)
    // Clean up partial file
    if (backupFile && fs.existsSync(backupFile)) {
      try { fs.unlinkSync(backupFile) } catch { /* ignore */ }
    }
    const job = makeJob(db, 'failed', 0, backupFile, errMsg, startedAt, backupType)
    saveBackup(job)
    return { ok: false, job, error: errMsg }
  }
}

export async function runAllBackups(backupType: BackupType = 'full', customPath?: string): Promise<BackupRunResult[]> {
  const dbs = loadDatabases().filter(d =>
    ['postgresql', 'mysql', 'mongodb', 'redis'].includes(d.engine) &&
    CONTAINER_MAP[d.id]
  )
  const targets = dbs.filter(d => d.id !== 'db-lab-pg-replica')
  const results: BackupRunResult[] = []
  for (const db of targets) {
    results.push(await runBackup(db, backupType, customPath))
  }
  return results
}

/** Delete a backup file + remove its record. Returns true if file was deleted. */
export function deleteBackup(id: string): { ok: boolean; fileDeleted: boolean; error?: string } {
  const list = loadBackups()
  const backup = list.find(b => b.id === id)
  if (!backup) return { ok: false, fileDeleted: false, error: 'Backup record not found' }

  let fileDeleted = false
  if (backup.location?.startsWith('file://')) {
    const filePath = backup.location.replace('file://', '')
    try {
      if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); fileDeleted = true }
    } catch (e) {
      return { ok: false, fileDeleted: false, error: (e as Error).message }
    }
  }

  // Remove record
  const updated = list.filter(b => b.id !== id)
  const DATA_DIR = path.join(process.cwd(), 'data')
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, 'backups.json'), JSON.stringify(updated, null, 2), 'utf8')
  return { ok: true, fileDeleted }
}

/** Remove backup files + records older than retentionDays. Returns count of deleted items. */
export function cleanupOldBackups(retentionDays: number): { filesDeleted: number; recordsRemoved: number } {
  const cutoff = Date.now() - retentionDays * 86400000
  let filesDeleted = 0

  // Delete files from disk
  if (fs.existsSync(BACKUP_DIR)) {
    for (const file of fs.readdirSync(BACKUP_DIR)) {
      const filePath = path.join(BACKUP_DIR, file)
      try {
        const stat = fs.statSync(filePath)
        if (stat.mtimeMs < cutoff) { fs.unlinkSync(filePath); filesDeleted++ }
      } catch { /* ignore */ }
    }
  }

  // Remove old records from JSON
  const list = loadBackups()
  const recent = list.filter(b => {
    const ts = b.completedAt ?? b.startedAt ?? b.scheduledAt
    return new Date(ts).getTime() > cutoff
  })
  const recordsRemoved = list.length - recent.length
  if (recordsRemoved > 0) {
    const DATA_DIR = path.join(process.cwd(), 'data')
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(path.join(DATA_DIR, 'backups.json'), JSON.stringify(recent, null, 2), 'utf8')
  }

  return { filesDeleted, recordsRemoved }
}

/** Disk usage stats for backup directory */
export function backupDiskStats(): { fileCount: number; totalMB: number; oldestDate: string | null; path: string } {
  if (!fs.existsSync(BACKUP_DIR)) return { fileCount: 0, totalMB: 0, oldestDate: null, path: BACKUP_DIR }

  const files = fs.readdirSync(BACKUP_DIR)
  let totalBytes = 0
  let oldestMs = Date.now()

  for (const file of files) {
    try {
      const stat = fs.statSync(path.join(BACKUP_DIR, file))
      totalBytes += stat.size
      if (stat.mtimeMs < oldestMs) oldestMs = stat.mtimeMs
    } catch { /* ignore */ }
  }

  return {
    fileCount: files.length,
    totalMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
    oldestDate: files.length > 0 ? new Date(oldestMs).toISOString() : null,
    path: BACKUP_DIR,
  }
}

function makeJob(
  db: DbConnection,
  status: BackupJob['status'],
  sizeMB: number,
  location: string,
  error?: string,
  startedAt?: string,
  backupType: BackupType = 'full',
): BackupJob {
  const now = new Date().toISOString()
  return {
    id: `bk-${crypto.randomUUID().slice(0, 8)}`,
    dbId: db.id, dbName: db.name,
    type: backupType === 'schema-only' ? 'logical' : backupType === 'data-only' ? 'logical' : 'full',
    status,
    scheduledAt: now,
    startedAt: startedAt ?? now,
    completedAt: now,
    sizeMB,
    rpoHrs: db.engine === 'redis' ? 0.5 : 24,
    rtoMins: db.engine === 'redis' ? 2 : db.engine === 'postgresql' ? 30 : 15,
    location: location ? `file://${location}` : '',
    error,
  }
}
