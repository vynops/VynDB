import fs from 'fs'
import path from 'path'

export interface AuditEntry {
  id: string
  actor: string
  action: string
  resource: string
  resourceId?: string
  success: boolean
  details?: Record<string, unknown>
  createdAt: string
}

const DATA_DIR = path.join(process.cwd(), 'data')
const AUDIT_FILE = path.join(DATA_DIR, 'audit-log.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function loadAuditLog(): AuditEntry[] {
  ensureDir()
  if (!fs.existsSync(AUDIT_FILE)) return []
  try { return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')) as AuditEntry[] } catch { return [] }
}

export function appendAudit(entry: Omit<AuditEntry, 'id' | 'createdAt'>): AuditEntry {
  const next: AuditEntry = {
    ...entry,
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }
  const entries = [next, ...loadAuditLog()].slice(0, 10_000)
  ensureDir()
  const tempFile = `${AUDIT_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tempFile, JSON.stringify(entries, null, 2), 'utf8')
  fs.renameSync(tempFile, AUDIT_FILE)
  return next
}