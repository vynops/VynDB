/**
 * VynDB Backup Runner
 * Executes real backups via `docker exec` against the lab containers.
 * Requires: vyndb user is in the `docker` group on the server.
 */

import { execFileSync, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { loadDatabases, saveBackup, loadBackups, type BackupJob, type DbConnection } from './db-store'

const BACKUP_DIR = path.join(process.cwd(), 'backups')
const COUCHBASE_REPO = 'vyndb'

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

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function shellQuote(value: string): string {
  return "'" + value.split("'").join("'\\''") + "'"
}

function couchbaseArchiveDir(db: DbConnection, targetDir: string): string {
  return path.join(targetDir, 'couchbase', safeId(db.id))
}

function couchbaseBackupEnv(db: DbConnection): NodeJS.ProcessEnv {
  const host = db.host.replace(/^(https?|couchbases?):\/\//i, '')
  return {
    ...process.env,
    CB_CLUSTER: `${db.ssl ? 'couchbases' : 'couchbase'}://${host}`,
    CB_USERNAME: db.username,
    CB_PASSWORD: db.passwordEnc,
  }
}

function runCouchbaseBackupCommand(db: DbConnection, args: string[], timeout = 120_000): string {
  const binary = process.env.VYNDB_CBBACKUPMGR_PATH || 'cbbackupmgr'
  return execFileSync(binary, args, {
    cwd: process.cwd(),
    env: couchbaseBackupEnv(db),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
  })
}

function directorySize(dir: string): number {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) total += directorySize(fullPath)
    else if (entry.isFile()) total += fs.statSync(fullPath).size
  }
  return total
}

function couchbaseInfo(db: DbConnection, archiveDir: string): {
  repos?: { name: string; backups?: { date?: string; complete?: boolean; size?: number }[] }[]
} {
  const output = runCouchbaseBackupCommand(db, ['info', '--archive', archiveDir, '--repo', COUCHBASE_REPO, '--json'])
  return JSON.parse(output)
}

function verifyCouchbaseBackupRecord(backup: BackupJob, db: DbConnection): { ok: boolean; message: string; sizeMB?: number } {
  const location = backup.location?.startsWith('file://') ? backup.location.slice(7) : backup.location
  if (!location || !backup.backupName) return { ok: false, message: 'Couchbase backup metadata is missing.' }
  const repoDir = path.dirname(location)
  const archiveDir = path.dirname(repoDir)
  if (path.basename(repoDir) !== COUCHBASE_REPO || path.basename(archiveDir) !== safeId(db.id)) {
    return { ok: false, message: 'Couchbase backup path does not match the database repository.' }
  }
  try {
    const info = couchbaseInfo(db, archiveDir)
    const record = info.repos?.find(repo => repo.name === COUCHBASE_REPO)?.backups?.find(item => item.date === backup.backupName)
    const size = fs.existsSync(location) ? directorySize(location) : 0
    return record?.complete && size > 0
      ? { ok: true, message: 'cbbackupmgr confirms the backup is complete and readable.', sizeMB: Math.round(size / 1024 / 1024 * 100) / 100 }
      : { ok: false, message: 'cbbackupmgr did not confirm a complete, non-empty backup.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function verifyCouchbaseBackup(backup: BackupJob): { ok: boolean; message: string; sizeMB?: number } {
  const db = loadDatabases().find(item => item.id === backup.dbId && item.engine === 'couchbase')
  return db ? verifyCouchbaseBackupRecord(backup, db) : { ok: false, message: 'Couchbase connection was not found.' }
}

function runCouchbaseBackup(db: DbConnection, targetDir: string): { backupFile: string; backupName: string; sizeMB: number } {
  const archiveDir = couchbaseArchiveDir(db, targetDir)
  const repoDir = path.join(archiveDir, COUCHBASE_REPO)
  ensureBackupDir(archiveDir)
  const env = couchbaseBackupEnv(db)
  const binary = process.env.VYNDB_CBBACKUPMGR_PATH || 'cbbackupmgr'

  if (!fs.existsSync(path.join(repoDir, 'backup-meta.json'))) {
    execFileSync(binary, ['config', '--archive', archiveDir, '--repo', COUCHBASE_REPO], {
      cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true,
    })
  }

  execFileSync(binary, ['backup', '--archive', archiveDir, '--repo', COUCHBASE_REPO, '--cluster', env.CB_CLUSTER!, '--no-progress-bar'], {
    cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30 * 60_000, windowsHide: true,
  })

  const infoOutput = execFileSync(binary, ['info', '--archive', archiveDir, '--repo', COUCHBASE_REPO, '--json'], {
    cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true,
  })
  const info = JSON.parse(infoOutput) as { repos?: { name: string; backups?: { date?: string; complete?: boolean }[] }[] }
  const backups = info.repos?.find(repo => repo.name === COUCHBASE_REPO)?.backups ?? []
  const latest = [...backups].filter(item => item.complete && item.date).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]
  if (!latest?.date) throw new Error('cbbackupmgr completed without reporting a complete backup.')
  const backupFile = path.join(repoDir, latest.date)
  if (!fs.existsSync(backupFile)) throw new Error('cbbackupmgr reported a backup directory that does not exist.')
  const sizeBytes = directorySize(backupFile)
  if (sizeBytes <= 0) throw new Error('cbbackupmgr reported an empty backup.')
  const sizeMB = Math.round(sizeBytes / 1024 / 1024 * 100) / 100
  return { backupFile, backupName: latest.date, sizeMB }
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
  if (!container && db.engine !== 'couchbase') {
    return {
      ok: false,
      job: makeJob(db, 'failed', 0, '', 'No container mapping for this DB'),
      error: `No container mapping for DB id: ${db.id}`,
    }
  }
  if (db.engine === 'couchbase' && backupType !== 'full') {
    return {
      ok: false,
      job: makeJob(db, 'failed', 0, '', 'Couchbase cbbackupmgr currently supports full-cluster backups only'),
      error: 'Couchbase cbbackupmgr currently supports full-cluster backups only',
    }
  }

  const ts = stamp()
  const startedAt = new Date().toISOString()
  let backupFile = ''
  let backupName: string | undefined
  let sizeMB = 0

  try {
    switch (db.engine) {
      case 'couchbase': {
        const result = runCouchbaseBackup(db, targetDir)
        backupFile = result.backupFile
        backupName = result.backupName
        sizeMB = result.sizeMB
        break
      }

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
        const authSource = db.username === 'admin' ? 'admin' : db.database
        const authFlags = db.username
          ? `-u ${shellQuote(db.username)} -p ${shellQuote(db.passwordEnc)} --authenticationDatabase ${shellQuote(authSource)} `
          : ''
        dockerExec(
          `docker exec ${container} mongodump ${authFlags}` +
          `--host 127.0.0.1 --port 27017 --db ${shellQuote(db.database)} ` +
          `--archive --gzip > ${shellQuote(backupFile)}`
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

    const job = makeJob(db, 'succeeded', sizeMB, backupFile, undefined, startedAt, backupType, backupName)
    saveBackup(job)
    return { ok: true, job }

  } catch (e) {
    const errMsg = (e as Error).message ?? String(e)
    // Clean up partial file
    if (backupFile && fs.existsSync(backupFile)) {
      try { fs.unlinkSync(backupFile) } catch { /* ignore */ }
    }
    const job = makeJob(db, 'failed', 0, backupFile, errMsg, startedAt, backupType, backupName)
    saveBackup(job)
    return { ok: false, job, error: errMsg }
  }
}

export async function runAllBackups(backupType: BackupType = 'full', customPath?: string): Promise<BackupRunResult[]> {
  const dbs = loadDatabases().filter(d => d.engine === 'couchbase' || (
    ['postgresql', 'mysql', 'mongodb', 'redis'].includes(d.engine) && CONTAINER_MAP[d.id]
  ))
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
      const db = loadDatabases().find(item => item.id === backup.dbId)
      if (db?.engine === 'couchbase') {
        const repoDir = path.dirname(filePath)
        const archiveDir = path.dirname(repoDir)
        const repo = path.basename(repoDir)
        const backupName = backup.backupName || path.basename(filePath)
        if (repo !== COUCHBASE_REPO || path.basename(archiveDir) !== safeId(db.id)) {
          return { ok: false, fileDeleted: false, error: 'Couchbase backup path does not match the database repository.' }
        }
        runCouchbaseBackupCommand(db, ['remove', '--archive', archiveDir, '--repo', repo, '--backups', backupName])
        fileDeleted = true
      } else if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) fs.rmSync(filePath, { recursive: true })
        else fs.unlinkSync(filePath)
        fileDeleted = true
      }
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
  const recent: BackupJob[] = []
  let recordsRemoved = 0
  for (const backup of list) {
    const ts = backup.completedAt ?? backup.startedAt ?? backup.scheduledAt
    if (new Date(ts).getTime() > cutoff) {
      recent.push(backup)
      continue
    }
    const db = loadDatabases().find(item => item.id === backup.dbId)
    if (db?.engine === 'couchbase') {
      const result = deleteBackup(backup.id)
      if (!result.ok) {
        recent.push(backup)
        continue
      }
      if (result.fileDeleted) filesDeleted++
    }
    recordsRemoved++
  }
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

  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(filePath)
      else if (entry.isFile()) files.push(filePath)
    }
  }
  walk(BACKUP_DIR)
  let totalBytes = 0
  let oldestMs = Date.now()

  for (const file of files) {
    try {
      const stat = fs.statSync(file)
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
  backupName?: string,
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
    backupName,
    error,
  }
}
