import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export type DbEngine = 'postgresql' | 'mysql' | 'oracle' | 'sqlserver' | 'mongodb' | 'redis' | 'couchbase'
export type DbEnv = 'production' | 'staging' | 'development' | 'test'
export type DbStatus = 'connected' | 'warning' | 'error' | 'unknown'

export interface DbConnection {
  id: string
  name: string
  engine: DbEngine
  host: string
  port: number
  database: string
  username: string
  passwordEnc: string   // XOR-obfuscated, not real encryption — store in env for prod
  ssl: boolean
  environment: DbEnv
  status: DbStatus
  healthScore: number   // 0–100
  lastChecked: string
  version?: string
  notes?: string
  createdAt: string
}

export interface SlowQuery {
  id: string
  dbId: string
  dbName: string
  engine: DbEngine
  query: string
  durationMs: number
  rowsExamined?: number
  rowsReturned?: number
  executedAt: string
  analyzed: boolean
  aiAnalysis?: {
    explanation: string
    bottleneck: string
    suggestions: string[]
    estimatedGain: string
    indexSuggestions: string[]
    confidence: number
  }
}

export interface PerformanceSnapshot {
  dbId: string
  timestamp: string
  tps: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
  activeConnections: number
  maxConnections: number
  cpuPct: number
  memPct: number
  diskReadMBps: number
  diskWriteMBps: number
  cacheHitRatio: number
}

export interface SchemaTable {
  dbId: string
  schema: string
  name: string
  engine: string
  rowCount: number
  sizeMB: number
  indexSizeMB: number
  columns: { name: string; type: string; nullable: boolean; default?: string }[]
  indexes: { name: string; columns: string[]; unique: boolean; type: string }[]
  lastAnalyzed?: string
}

export interface BackupJob {
  id: string
  dbId: string
  dbName: string
  type: 'full' | 'incremental' | 'wal' | 'logical'
  status: 'scheduled' | 'running' | 'succeeded' | 'failed' | 'skipped'
  scheduledAt: string
  startedAt?: string
  completedAt?: string
  sizeMB: number
  rpoHrs: number    // RPO this backup achieves
  rtoMins: number   // estimated RTO
  location: string
  error?: string
}

export interface ReplicationStatus {
  dbId: string
  dbName: string
  engine: DbEngine
  role: 'primary' | 'replica' | 'standby' | 'unknown'
  lagSeconds: number
  lagBytes?: number
  syncState?: string
  connectedReplicas?: number
  lastSyncAt: string
  status: 'healthy' | 'warning' | 'critical'
}

const DATA_DIR = path.join(process.cwd(), 'data')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function load<T>(file: string, defaultVal: T): T {
  ensureDir()
  const p = path.join(DATA_DIR, file)
  if (!fs.existsSync(p)) return defaultVal
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T } catch { return defaultVal }
}

function save(file: string, data: unknown) {
  ensureDir()
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8')
}

// ────────── DB Connections ──────────
const DEMO_DBS: DbConnection[] = [
  {
    id: 'db-001', name: 'prod-postgres', engine: 'postgresql', host: 'db.prod.internal',
    port: 5432, database: 'appdb', username: 'appuser', passwordEnc: '', ssl: true,
    environment: 'production', status: 'connected', healthScore: 94,
    lastChecked: new Date(Date.now() - 45_000).toISOString(), version: 'PostgreSQL 16.2',
    createdAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
  },
  {
    id: 'db-002', name: 'prod-mysql', engine: 'mysql', host: 'mysql.prod.internal',
    port: 3306, database: 'orders', username: 'orders_user', passwordEnc: '', ssl: true,
    environment: 'production', status: 'connected', healthScore: 88,
    lastChecked: new Date(Date.now() - 30_000).toISOString(), version: 'MySQL 8.0.36',
    createdAt: new Date(Date.now() - 25 * 86400_000).toISOString(),
  },
  {
    id: 'db-003', name: 'staging-postgres', engine: 'postgresql', host: 'db.staging.internal',
    port: 5432, database: 'appdb_stage', username: 'appuser', passwordEnc: '', ssl: false,
    environment: 'staging', status: 'connected', healthScore: 97,
    lastChecked: new Date(Date.now() - 60_000).toISOString(), version: 'PostgreSQL 15.6',
    createdAt: new Date(Date.now() - 20 * 86400_000).toISOString(),
  },
  {
    id: 'db-004', name: 'analytics-oracle', engine: 'oracle', host: 'oracle.corp.internal',
    port: 1521, database: 'ORCL', username: 'analytics', passwordEnc: '', ssl: true,
    environment: 'production', status: 'warning', healthScore: 71,
    lastChecked: new Date(Date.now() - 120_000).toISOString(), version: 'Oracle 19c (19.3)',
    notes: 'Tablespace USERS at 82% — schedule cleanup', createdAt: new Date(Date.now() - 60 * 86400_000).toISOString(),
  },
  {
    id: 'db-005', name: 'cache-redis', engine: 'redis', host: 'redis.prod.internal',
    port: 6379, database: '0', username: '', passwordEnc: '', ssl: false,
    environment: 'production', status: 'connected', healthScore: 99,
    lastChecked: new Date(Date.now() - 15_000).toISOString(), version: 'Redis 7.2.4',
    createdAt: new Date(Date.now() - 15 * 86400_000).toISOString(),
  },
  {
    id: 'db-006', name: 'app-mongodb', engine: 'mongodb', host: 'mongo.prod.internal',
    port: 27017, database: 'appdb', username: 'appuser', passwordEnc: '', ssl: true,
    environment: 'production', status: 'connected', healthScore: 91,
    lastChecked: new Date(Date.now() - 50_000).toISOString(), version: 'MongoDB 7.0.5',
    createdAt: new Date(Date.now() - 45 * 86400_000).toISOString(),
  },
  {
    id: 'db-007', name: 'reports-sqlserver', engine: 'sqlserver', host: 'sqlsrv.corp.internal',
    port: 1433, database: 'ReportsDB', username: 'reports_svc', passwordEnc: '', ssl: true,
    environment: 'production', status: 'connected', healthScore: 85,
    lastChecked: new Date(Date.now() - 90_000).toISOString(), version: 'SQL Server 2022',
    createdAt: new Date(Date.now() - 90 * 86400_000).toISOString(),
  },
]

export function loadDatabases(): DbConnection[] {
  const file = path.join(DATA_DIR, 'databases.json')
  ensureDir()
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEMO_DBS, null, 2), 'utf8')
    return DEMO_DBS
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as DbConnection[] } catch { return DEMO_DBS }
}

export function saveDatabase(db: DbConnection): void {
  const list = loadDatabases()
  const idx = list.findIndex(d => d.id === db.id)
  if (idx === -1) { list.push(db) } else { list[idx] = db }
  save('databases.json', list)
}

export function deleteDatabase(id: string): void {
  const list = loadDatabases().filter(d => d.id !== id)
  save('databases.json', list)
}

// ────────── Slow Queries ──────────
const DEMO_QUERIES: SlowQuery[] = [
  {
    id: 'q-001', dbId: 'db-001', dbName: 'prod-postgres', engine: 'postgresql',
    query: 'SELECT u.*, o.* FROM users u JOIN orders o ON u.id = o.user_id WHERE o.created_at > $1 ORDER BY o.total DESC',
    durationMs: 4820, rowsExamined: 2400000, rowsReturned: 1240,
    executedAt: new Date(Date.now() - 300_000).toISOString(), analyzed: false,
  },
  {
    id: 'q-002', dbId: 'db-002', dbName: 'prod-mysql', engine: 'mysql',
    query: 'SELECT * FROM order_items WHERE product_id IN (SELECT id FROM products WHERE category = "electronics") AND status != "cancelled"',
    durationMs: 7340, rowsExamined: 8900000, rowsReturned: 3420,
    executedAt: new Date(Date.now() - 900_000).toISOString(), analyzed: true,
    aiAnalysis: {
      explanation: 'Full table scan on order_items due to correlated subquery. The subquery runs once per outer row, creating an O(n²) complexity.',
      bottleneck: 'Missing composite index on (product_id, status) in order_items table',
      suggestions: [
        'Replace the subquery with a JOIN for better optimizer visibility',
        'Add a composite index on order_items (product_id, status)',
        'Consider a partial index filtering out "cancelled" rows',
      ],
      estimatedGain: '85–95% reduction in query time',
      indexSuggestions: [
        'CREATE INDEX CONCURRENTLY idx_order_items_product_status ON order_items (product_id, status) WHERE status != \'cancelled\';',
      ],
      confidence: 92,
    },
  },
  {
    id: 'q-003', dbId: 'db-001', dbName: 'prod-postgres', engine: 'postgresql',
    query: 'UPDATE sessions SET last_active = NOW() WHERE token = $1',
    durationMs: 2150, executedAt: new Date(Date.now() - 1_800_000).toISOString(), analyzed: false,
  },
  {
    id: 'q-004', dbId: 'db-004', dbName: 'analytics-oracle', engine: 'oracle',
    query: 'SELECT /*+ FULL(t) */ t.region, SUM(t.amount) FROM transactions t WHERE t.created_date BETWEEN :1 AND :2 GROUP BY t.region',
    durationMs: 12800, rowsExamined: 45000000, rowsReturned: 24,
    executedAt: new Date(Date.now() - 3_600_000).toISOString(), analyzed: false,
  },
  {
    id: 'q-005', dbId: 'db-006', dbName: 'app-mongodb', engine: 'mongodb',
    query: 'db.events.find({ userId: ObjectId("..."), type: { $in: ["click","view","purchase"] }, ts: { $gte: ISODate("2026-01-01") } }).sort({ ts: -1 })',
    durationMs: 3670, rowsExamined: 1200000, rowsReturned: 5600,
    executedAt: new Date(Date.now() - 7_200_000).toISOString(), analyzed: false,
  },
]

export function loadSlowQueries(): SlowQuery[] {
  const file = path.join(DATA_DIR, 'slow-queries.json')
  ensureDir()
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEMO_QUERIES, null, 2), 'utf8')
    return DEMO_QUERIES
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as SlowQuery[] } catch { return DEMO_QUERIES }
}

export function saveSlowQuery(q: SlowQuery): void {
  const list = loadSlowQueries()
  const idx = list.findIndex(x => x.id === q.id)
  if (idx === -1) { list.unshift(q) } else { list[idx] = q }
  save('slow-queries.json', list)
}

export function addAnalyzedQuery(q: SlowQuery): void { saveSlowQuery(q) }

// ────────── Performance (generated dynamically) ──────────
export function generatePerformanceHistory(dbId: string, hours = 24): PerformanceSnapshot[] {
  const snap: PerformanceSnapshot[] = []
  const now = Date.now()
  const stepMs = (hours * 3600_000) / 48   // 48 data points

  // Base values per DB
  const base: Record<string, { tps: number; lat: number; conn: number; cpu: number }> = {
    'db-001': { tps: 480, lat: 12, conn: 85, cpu: 42 },
    'db-002': { tps: 320, lat: 18, conn: 60, cpu: 38 },
    'db-003': { tps: 120, lat: 8, conn: 25, cpu: 22 },
    'db-004': { tps: 80, lat: 45, conn: 40, cpu: 55 },
    'db-005': { tps: 12400, lat: 1, conn: 200, cpu: 15 },
    'db-006': { tps: 260, lat: 22, conn: 45, cpu: 31 },
    'db-007': { tps: 150, lat: 28, conn: 35, cpu: 28 },
  }
  const b = base[dbId] ?? { tps: 100, lat: 20, conn: 30, cpu: 30 }

  for (let i = 48; i >= 0; i--) {
    const ts = new Date(now - i * stepMs)
    const noise = () => (Math.random() - 0.5) * 0.3
    snap.push({
      dbId,
      timestamp: ts.toISOString(),
      tps: Math.max(1, Math.round(b.tps * (1 + noise()))),
      latencyP50Ms: Math.max(1, Math.round(b.lat * (1 + noise()))),
      latencyP95Ms: Math.max(2, Math.round(b.lat * 2.5 * (1 + noise()))),
      latencyP99Ms: Math.max(3, Math.round(b.lat * 5 * (1 + noise()))),
      activeConnections: Math.max(1, Math.round(b.conn * (1 + noise()))),
      maxConnections: 200,
      cpuPct: Math.min(99, Math.max(1, Math.round(b.cpu * (1 + noise())))),
      memPct: Math.min(99, Math.max(10, Math.round(55 * (1 + noise())))),
      diskReadMBps: Math.max(0.1, parseFloat((12 * (1 + noise())).toFixed(1))),
      diskWriteMBps: Math.max(0.1, parseFloat((5 * (1 + noise())).toFixed(1))),
      cacheHitRatio: Math.min(99.9, Math.max(80, parseFloat((96 * (1 + noise() * 0.1)).toFixed(1)))),
    })
  }
  return snap
}

// ────────── Schema ──────────
const DEMO_SCHEMA: SchemaTable[] = [
  {
    dbId: 'db-001', schema: 'public', name: 'users', engine: 'heap',
    rowCount: 2_840_000, sizeMB: 512, indexSizeMB: 128,
    columns: [
      { name: 'id', type: 'bigint', nullable: false, default: 'nextval(...)' },
      { name: 'email', type: 'varchar(255)', nullable: false },
      { name: 'name', type: 'varchar(100)', nullable: true },
      { name: 'created_at', type: 'timestamptz', nullable: false, default: 'now()' },
      { name: 'status', type: 'varchar(20)', nullable: false, default: "'active'" },
    ],
    indexes: [
      { name: 'users_pkey', columns: ['id'], unique: true, type: 'btree' },
      { name: 'users_email_idx', columns: ['email'], unique: true, type: 'btree' },
      { name: 'users_status_created_idx', columns: ['status', 'created_at'], unique: false, type: 'btree' },
    ],
    lastAnalyzed: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    dbId: 'db-001', schema: 'public', name: 'orders', engine: 'heap',
    rowCount: 18_500_000, sizeMB: 4200, indexSizeMB: 890,
    columns: [
      { name: 'id', type: 'bigint', nullable: false },
      { name: 'user_id', type: 'bigint', nullable: false },
      { name: 'total', type: 'numeric(12,2)', nullable: false },
      { name: 'status', type: 'varchar(20)', nullable: false },
      { name: 'created_at', type: 'timestamptz', nullable: false },
    ],
    indexes: [
      { name: 'orders_pkey', columns: ['id'], unique: true, type: 'btree' },
      { name: 'orders_user_id_idx', columns: ['user_id'], unique: false, type: 'btree' },
      { name: 'orders_status_idx', columns: ['status', 'created_at'], unique: false, type: 'btree' },
    ],
  },
  {
    dbId: 'db-002', schema: 'orders', name: 'order_items', engine: 'InnoDB',
    rowCount: 52_000_000, sizeMB: 8900, indexSizeMB: 2100,
    columns: [
      { name: 'id', type: 'bigint', nullable: false },
      { name: 'order_id', type: 'bigint', nullable: false },
      { name: 'product_id', type: 'int', nullable: false },
      { name: 'qty', type: 'int', nullable: false },
      { name: 'price', type: 'decimal(10,2)', nullable: false },
      { name: 'status', type: 'varchar(20)', nullable: false },
    ],
    indexes: [
      { name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' },
      { name: 'idx_order_id', columns: ['order_id'], unique: false, type: 'BTREE' },
    ],
  },
]

export function loadSchema(): SchemaTable[] {
  return load('schema.json', DEMO_SCHEMA)
}

// ────────── Backups ──────────
const now = Date.now()
const DEMO_BACKUPS: BackupJob[] = [
  {
    id: 'bk-001', dbId: 'db-001', dbName: 'prod-postgres', type: 'full',
    status: 'succeeded', scheduledAt: new Date(now - 14400_000).toISOString(),
    startedAt: new Date(now - 14000_000).toISOString(), completedAt: new Date(now - 13200_000).toISOString(),
    sizeMB: 4820, rpoHrs: 4, rtoMins: 45, location: 's3://backups/prod-postgres/2026-07-07/',
  },
  {
    id: 'bk-002', dbId: 'db-001', dbName: 'prod-postgres', type: 'wal',
    status: 'running', scheduledAt: new Date(now - 300_000).toISOString(),
    startedAt: new Date(now - 300_000).toISOString(), sizeMB: 0, rpoHrs: 0.08, rtoMins: 5,
    location: 's3://backups/prod-postgres/wal/',
  },
  {
    id: 'bk-003', dbId: 'db-002', dbName: 'prod-mysql', type: 'full',
    status: 'succeeded', scheduledAt: new Date(now - 86400_000).toISOString(),
    startedAt: new Date(now - 86200_000).toISOString(), completedAt: new Date(now - 84800_000).toISOString(),
    sizeMB: 12400, rpoHrs: 24, rtoMins: 90, location: '/mnt/nas/mysql/full/',
  },
  {
    id: 'bk-004', dbId: 'db-004', dbName: 'analytics-oracle', type: 'incremental',
    status: 'failed', scheduledAt: new Date(now - 28800_000).toISOString(),
    startedAt: new Date(now - 28600_000).toISOString(), sizeMB: 0, rpoHrs: 8, rtoMins: 120,
    location: '/backup/oracle/', error: 'RMAN-03002: failure of backup command at 07/07/2026 02:14:55',
  },
  {
    id: 'bk-005', dbId: 'db-006', dbName: 'app-mongodb', type: 'logical',
    status: 'succeeded', scheduledAt: new Date(now - 7200_000).toISOString(),
    startedAt: new Date(now - 7100_000).toISOString(), completedAt: new Date(now - 6200_000).toISOString(),
    sizeMB: 2840, rpoHrs: 2, rtoMins: 30, location: 's3://backups/mongodb/2026-07-07/',
  },
  {
    id: 'bk-006', dbId: 'db-007', dbName: 'reports-sqlserver', type: 'full',
    status: 'scheduled', scheduledAt: new Date(now + 3600_000).toISOString(),
    sizeMB: 0, rpoHrs: 24, rtoMins: 60, location: '\\\\NAS\\SQL\\reports\\',
  },
]

export function loadBackups(): BackupJob[] { return load('backups.json', DEMO_BACKUPS) }

export function saveBackup(b: BackupJob): void {
  const list = loadBackups()
  const idx = list.findIndex(x => x.id === b.id)
  if (idx === -1) { list.unshift(b) } else { list[idx] = b }
  save('backups.json', list)
}

// ────────── Replication ──────────
const DEMO_REPLICATION: ReplicationStatus[] = [
  {
    dbId: 'db-001', dbName: 'prod-postgres', engine: 'postgresql',
    role: 'primary', lagSeconds: 0, connectedReplicas: 2,
    lastSyncAt: new Date(Date.now() - 1000).toISOString(), status: 'healthy',
  },
  {
    dbId: 'db-001-r1', dbName: 'prod-postgres-replica-1', engine: 'postgresql',
    role: 'replica', lagSeconds: 0.4, lagBytes: 8192,
    syncState: 'streaming', lastSyncAt: new Date(Date.now() - 2000).toISOString(), status: 'healthy',
  },
  {
    dbId: 'db-002', dbName: 'prod-mysql', engine: 'mysql',
    role: 'primary', lagSeconds: 0, connectedReplicas: 1,
    lastSyncAt: new Date(Date.now() - 500).toISOString(), status: 'healthy',
  },
  {
    dbId: 'db-002-r1', dbName: 'prod-mysql-replica', engine: 'mysql',
    role: 'replica', lagSeconds: 12.8, lagBytes: 2097152,
    syncState: 'syncing', lastSyncAt: new Date(Date.now() - 15000).toISOString(), status: 'warning',
  },
  {
    dbId: 'db-007', dbName: 'reports-sqlserver', engine: 'sqlserver',
    role: 'primary', lagSeconds: 0, connectedReplicas: 1,
    lastSyncAt: new Date(Date.now() - 800).toISOString(), status: 'healthy',
  },
]

export function loadReplication(): ReplicationStatus[] {
  return load('replication.json', DEMO_REPLICATION)
}

// ────────── Capacity ──────────
export interface CapacityEntry {
  dbId: string
  dbName: string
  totalSizeMB: number
  dataSizeMB: number
  indexSizeMB: number
  freeSizeMB: number
  growthMBPerDay: number
  daysUntilFull: number
  indexBloatPct: number
  tableBloatPct: number
  topTables: { name: string; sizeMB: number; growthMBPerDay: number }[]
}

const DEMO_CAPACITY: CapacityEntry[] = [
  {
    dbId: 'db-001', dbName: 'prod-postgres', totalSizeMB: 51200, dataSizeMB: 38400,
    indexSizeMB: 8900, freeSizeMB: 3900, growthMBPerDay: 420, daysUntilFull: 82,
    indexBloatPct: 18, tableBloatPct: 12,
    topTables: [
      { name: 'orders', sizeMB: 4200, growthMBPerDay: 180 },
      { name: 'order_items', sizeMB: 8900, growthMBPerDay: 240 },
      { name: 'events', sizeMB: 12400, growthMBPerDay: 350 },
    ],
  },
  {
    dbId: 'db-002', dbName: 'prod-mysql', totalSizeMB: 102400, dataSizeMB: 78400,
    indexSizeMB: 18200, freeSizeMB: 5800, growthMBPerDay: 680, daysUntilFull: 41,
    indexBloatPct: 8, tableBloatPct: 5,
    topTables: [
      { name: 'order_items', sizeMB: 8900, growthMBPerDay: 240 },
      { name: 'products', sizeMB: 2100, growthMBPerDay: 40 },
    ],
  },
  {
    dbId: 'db-004', dbName: 'analytics-oracle', totalSizeMB: 204800, dataSizeMB: 168000,
    indexSizeMB: 28000, freeSizeMB: 8800, growthMBPerDay: 1200, daysUntilFull: 28,
    indexBloatPct: 22, tableBloatPct: 15,
    topTables: [
      { name: 'transactions', sizeMB: 45000, growthMBPerDay: 650 },
      { name: 'audit_log', sizeMB: 28000, growthMBPerDay: 420 },
    ],
  },
]

export function loadCapacity(): CapacityEntry[] {
  return load('capacity.json', DEMO_CAPACITY)
}

// ────────── Security ──────────
export interface SecurityFinding {
  id: string
  dbId: string
  dbName: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: 'privilege' | 'encryption' | 'auth' | 'config' | 'compliance'
  title: string
  description: string
  recommendation: string
  detectedAt: string
  status: 'open' | 'acknowledged' | 'resolved'
}

const DEMO_SECURITY: SecurityFinding[] = [
  {
    id: 'sec-001', dbId: 'db-001', dbName: 'prod-postgres', severity: 'high',
    category: 'privilege', title: 'Superuser account in application use',
    description: 'The user "appuser" has SUPERUSER privileges but is used for application connections.',
    recommendation: 'Create a least-privilege role with only SELECT, INSERT, UPDATE, DELETE on required tables.',
    detectedAt: new Date(Date.now() - 3600_000).toISOString(), status: 'open',
  },
  {
    id: 'sec-002', dbId: 'db-004', dbName: 'analytics-oracle', severity: 'critical',
    category: 'auth', title: 'Multiple failed login attempts — brute-force indicator',
    description: '482 failed login attempts for user SYS in the last 24 hours from 3 distinct IPs.',
    recommendation: 'Block source IPs, enable Oracle account lockout after 5 failures (FAILED_LOGIN_ATTEMPTS=5).',
    detectedAt: new Date(Date.now() - 1800_000).toISOString(), status: 'open',
  },
  {
    id: 'sec-003', dbId: 'db-003', dbName: 'staging-postgres', severity: 'medium',
    category: 'encryption', title: 'SSL not enforced for all connections',
    description: 'pg_hba.conf allows non-SSL connections from internal subnet 10.0.0.0/8.',
    recommendation: 'Set ssl=on and require hostssl entries in pg_hba.conf for all non-localhost connections.',
    detectedAt: new Date(Date.now() - 7200_000).toISOString(), status: 'acknowledged',
  },
  {
    id: 'sec-004', dbId: 'db-002', dbName: 'prod-mysql', severity: 'low',
    category: 'compliance', title: 'Binary log expiration too short for PCI-DSS',
    description: 'binlog_expire_logs_seconds = 86400 (1 day). PCI-DSS requires 90-day audit trail.',
    recommendation: 'Set binlog_expire_logs_seconds = 7776000 (90 days) and ensure disk capacity.',
    detectedAt: new Date(Date.now() - 86400_000).toISOString(), status: 'open',
  },
]

export function loadSecurity(): SecurityFinding[] {
  return load('security.json', DEMO_SECURITY)
}

export function saveSecurityFinding(f: SecurityFinding): void {
  const list = loadSecurity()
  const idx = list.findIndex(x => x.id === f.id)
  if (idx !== -1) list[idx] = f
  save('security.json', list)
}
