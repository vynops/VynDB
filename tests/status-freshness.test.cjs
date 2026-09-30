const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks, cwd) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => mocks[name] ?? require(name), process: { cwd: () => cwd, pid: process.pid, env: { VYNDB_METRICS_TOKEN: 'test-token' } }, Date, URL, console, setTimeout }, { filename: file })
  return exports
}

class NextResponse {
  static json(body, options) { return { body, status: options?.status ?? 200 } }
}

async function fixture(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-status-'))
  fs.mkdirSync(path.join(dir, 'data'))
  try { return await callback(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('missing database file stays empty and corrupt data fails closed', () => fixture(dir => {
  const freshness = load('src/lib/status-freshness.ts', {}, dir)
  const store = load('src/lib/db-store.ts', { './status-freshness': freshness }, dir)
  assert.equal(store.loadDatabases().length, 0)
  assert.equal(fs.existsSync(path.join(dir, 'data', 'databases.json')), false)
  fs.writeFileSync(path.join(dir, 'data', 'databases.json'), '{broken')
  assert.throws(() => store.loadDatabases(), /JSON|Unexpected/)
}))

test('missing monitored resources never produce sample records', () => fixture(dir => {
  const freshness = load('src/lib/status-freshness.ts', {}, dir)
  const store = load('src/lib/db-store.ts', { './status-freshness': freshness }, dir)
  for (const resource of ['loadSlowQueries', 'loadSchema', 'loadBackups', 'loadReplication', 'loadCapacity', 'loadSecurity']) {
    assert.equal(store[resource]().length, 0, resource)
  }
}))

test('old status is unknown without overwriting stored state; failure is immediate', () => fixture(dir => {
  const freshness = load('src/lib/status-freshness.ts', {}, dir)
  const store = load('src/lib/db-store.ts', { './status-freshness': freshness }, dir)
  const db = { id: 'db-1', name: 'example', engine: 'postgresql', status: 'connected', healthScore: 92,
    lastChecked: new Date(Date.now() - 60 * 60_000).toISOString() }
  store.saveDatabase(db)
  assert.equal(store.loadDatabases()[0].status, 'unknown')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'databases.json')))[0].status, 'connected')
  store.recordDatabaseConnectionFailure('db-1')
  assert.equal(store.loadDatabases()[0].status, 'error')
  assert.equal(store.loadDatabases()[0].healthScore, 0)
  store.saveDatabase({ ...db, lastChecked: new Date().toISOString() })
  assert.equal(store.loadDatabases()[0].status, 'connected')
}))

test('query connection failure marks only its target; SQL error does not', async () => {
  const failures = []
  let pool = null
  let engine = 'postgresql'
  const route = load('src/app/api/databases/[id]/query/route.ts', {
    'next/server': { NextResponse },
    '@/lib/auth': { requireRole: async () => ({ email: 'operator' }) },
    '@/lib/db-store': { loadDatabases: () => [{ id: 'db-1', engine, database: 'app' }], recordDatabaseConnectionFailure: id => failures.push(id) },
    '@/lib/db-connections': {
      getPgPool: async () => pool,
      getMongoClient: async () => ({ db: () => ({ collection: () => ({ find: () => ({ limit: () => ({ toArray: async () => {
        const error = new Error('connection lost'); error.name = 'MongoNetworkError'; throw error
      } }) }) }) }) }),
    },
  }, process.cwd())
  const request = { json: async () => ({ sql: 'SELECT 1' }) }
  const params = { params: Promise.resolve({ id: 'db-1' }) }
  assert.equal((await route.POST(request, params)).status, 503)
  assert.deepEqual(failures, ['db-1'])
  pool = { query: async () => { throw new Error('syntax error') } }
  assert.equal((await route.POST(request, params)).status, 400)
  assert.deepEqual(failures, ['db-1'])
  pool = { query: async () => { const error = new Error('connection lost'); error.code = 'ECONNRESET'; throw error } }
  assert.equal((await route.POST(request, params)).status, 503)
  assert.deepEqual(failures, ['db-1', 'db-1'])
  engine = 'mongodb'
  assert.equal((await route.POST({ json: async () => ({ sql: 'db.users.find({})' }) }, params)).status, 503)
  assert.deepEqual(failures, ['db-1', 'db-1', 'db-1'])
})

test('fleet metrics exclude stale or failed databases and never generate samples', async () => {
  await fixture(async dir => {
    const freshness = load('src/lib/status-freshness.ts', {}, dir)
    fs.writeFileSync(path.join(dir, 'data', 'perf-snapshots.json'), JSON.stringify([
      { dbId: 'db-1', timestamp: new Date(Date.now() - 60_000).toISOString(), tps: 5 },
      { dbId: 'db-2', timestamp: new Date(Date.now() - 60_000).toISOString(), tps: 7 },
    ]))
    const route = load('src/app/api/performance/route.ts', {
      'next/server': { NextResponse },
      '@/lib/auth': { requireRole: async () => ({ email: 'operator' }) },
      '@/lib/db-store': { loadDatabases: () => [{ id: 'db-1', status: 'connected' }, { id: 'db-2', status: 'error' }, { id: 'db-3', status: 'connected' }], STATUS_STALE_MS: freshness.STATUS_STALE_MS },
    }, dir)
    const response = await route.GET({ url: 'http://localhost/api/performance' })
    assert.equal(response.body.length, 1)
    assert.equal(response.body[0].dbId, 'db-1')
    assert.equal(response.body[0].dataQuality, 'real')
    const history = await route.GET({ url: 'http://localhost/api/performance?dbId=db-3' })
    assert.equal(history.body.length, 0)
  })
})

test('capacity and replication endpoints require a recently checked parent', async () => {
  const databases = [{ id: 'db-1', status: 'connected' }, { id: 'db-2', status: 'unknown' }]
  const fresh = new Date().toISOString()
  const old = new Date(Date.now() - 60 * 60_000).toISOString()
  const mocks = {
    'next/server': { NextResponse },
    '@/lib/auth': { requireRole: async () => ({ email: 'operator' }) },
    '@/lib/db-store': {
      loadDatabases: () => databases,
      STATUS_STALE_MS: 15 * 60_000,
      loadCapacity: () => [{ dbId: 'db-1', collectedAt: fresh }, { dbId: 'db-1', collectedAt: old }, { dbId: 'db-2', collectedAt: fresh }],
      loadReplication: () => [{ dbId: 'db-1-r1', lastSyncAt: '2020-01-01', collectedAt: fresh }, { dbId: 'db-1-r2', collectedAt: old }, { dbId: 'db-2-r1', collectedAt: fresh }],
    },
  }
  const capacity = load('src/app/api/capacity/route.ts', mocks, process.cwd())
  const replication = load('src/app/api/replication/route.ts', mocks, process.cwd())
  assert.equal((await capacity.GET({})).body.length, 1)
  assert.equal((await replication.GET({})).body.length, 1)
  assert.equal((await replication.GET({})).body[0].dbId, 'db-1-r1')
})

test('aggregate metrics expose unknown status without exporting stale resource values', async () => {
  await fixture(async dir => {
    fs.writeFileSync(path.join(dir, 'data', 'perf-snapshots.json'), JSON.stringify([
      { dbId: 'db-1', timestamp: new Date(Date.now() - 60 * 60_000).toISOString(), activeConnections: 5, tps: 3 },
    ]))
    class TextResponse { constructor(body) { this.body = body } }
    const route = load('src/app/api/metrics/route.ts', {
      'next/server': { NextResponse: TextResponse },
      '@/lib/status-freshness': { STATUS_STALE_MS: 15 * 60_000 },
      '@/lib/db-store': {
        loadDatabases: () => [{ id: 'db-1', name: 'sample', engine: 'postgresql', status: 'unknown', healthScore: 90, lastChecked: new Date(Date.now() - 60 * 60_000).toISOString() }],
        loadCapacity: () => [{ dbId: 'db-1', totalSizeMB: 100, collectedAt: new Date().toISOString() }],
        loadReplication: () => [{ dbId: 'db-1', engine: 'postgresql', lagSeconds: 1, collectedAt: new Date().toISOString() }],
        loadSecurity: () => [], loadSlowQueries: () => [],
      },
    }, dir)
    const output = (await route.GET({ headers: { get: () => 'Bearer test-token' } })).body
    assert.match(output, /vyndb_database_status\{[^\n]*status="unknown"\} 1/)
    assert.match(output, /vyndb_database_last_checked_timestamp_seconds\{/)
    for (const name of ['vyndb_database_health_score{', 'vyndb_database_active_connections{', 'vyndb_replication_lag_seconds{', 'vyndb_capacity_size_mb{']) {
      assert.equal(output.includes(name), false, name)
    }
  })
})