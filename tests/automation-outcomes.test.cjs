const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadTypeScript(file, mocks = {}, cwd = process.cwd()) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require: name => name in mocks ? mocks[name] : require(name),
    process: { cwd: () => cwd, pid: process.pid },
    console,
    Date,
    setTimeout,
  }, { filename: file })
  return exports
}

test('missing operational files do not expose demo records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-store-'))
  try {
    const store = loadTypeScript('src/lib/automation-store.ts', {}, directory)
    assert.equal(store.loadRules().length, 0)
    assert.equal(store.loadRuns().length, 0)
    assert.equal(store.loadProposals().length, 0)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('threshold database actions are recorded as skipped, not executed', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-monitor-'))
  const runs = []
  const savedRules = []
  try {
    const monitor = loadTypeScript('src/lib/monitor.ts', {
      './db-store': {
        loadDatabases: () => [{ id: 'db-1', name: 'sample', engine: 'postgresql', status: 'connected' }],
        loadSlowQueries: () => [{ dbId: 'db-1', executedAt: new Date().toISOString() }], loadCapacity: () => [], loadReplication: () => [],
      },
      './automation-store': {
        loadRules: () => [{ id: 'rule-1', name: 'Maintenance', dbId: 'db-1', trigger: 'threshold', enabled: true,
          thresholdMetric: 'slow_query_count', thresholdOperator: '>', thresholdValue: 0,
          actions: [{ type: 'custom_sql', sql: 'ANALYZE;' }], runCount: 0 }],
        saveRule: rule => savedRules.push(rule), addRun: run => runs.push(run), loadProposals: () => [],
      },
      './incident-store': {
        loadIncidents: () => [], addIncident: () => {}, patchIncident: () => {}, loadEscalations: () => [],
        currentOnCallEmails: () => [], matchRouting: () => ({ notifyEmails: [] }),
      },
      './notifier': { sendSlack: async () => {}, sendTeams: async () => {}, sendWebhook: async () => {}, sendEmail: async () => {} },
      './settings-store': { getSettings: () => ({ backupRpoBreachAlertHrs: 24 }) },
      './audit-store': { appendAudit: () => {} },
      './status-freshness': { isStatusStale: () => false },
    }, directory)
    await monitor.runMonitor()
    assert.equal(runs[0].status, 'skipped')
    assert.match(runs[0].output, /database actions not executed: custom_sql/)
    assert.equal(savedRules[0].lastRunStatus, 'skipped')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

const policy = loadTypeScript('src/lib/maintenance-policy.ts')

test('maintenance policy rejects arbitrary, multi-statement and global SQL', () => {
  const allowed = policy.permittedMaintenanceSql
  assert.equal(allowed('postgresql', 'analyze', 'ANALYZE public.orders;'), 'ANALYZE public.orders;')
  assert.equal(allowed('mysql', 'analyze', 'ANALYZE TABLE orders;'), 'ANALYZE TABLE orders;')
  for (const sql of ['ANALYZE;', 'ANALYZE orders;', 'ANALYZE public.orders; DROP TABLE orders;', 'SELECT 1', 'ANALYZE "orders"']) {
    assert.equal(allowed('postgresql', 'analyze', sql), null)
  }
  assert.equal(allowed('postgresql', 'custom_sql', 'ANALYZE orders;'), null)
  assert.equal(allowed('mysql', 'analyze', 'ANALYZE TABLE otherdb.orders;'), null)
  assert.equal(allowed('mongodb', 'analyze', 'ANALYZE orders;'), null)
})

test('execution claims reject duplicates after restart and retain an uncertain outcome', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-claims-'))
  try {
    const first = loadTypeScript('src/lib/execution-claims.ts', {}, directory)
    const claim = first.claimExecution('proposal:sample')
    assert.equal(claim.claimed, true)
    const restarted = loadTypeScript('src/lib/execution-claims.ts', {}, directory)
    assert.equal(restarted.claimExecution('proposal:sample').claimed, false)
    restarted.finishExecution(claim.record, 'unverified', true)
    assert.equal(first.claimExecution('proposal:sample').record.state, 'unverified')
    assert.throws(() => first.releaseExecution(claim.record), /resolved/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('completed rule lock can be released without erasing the request receipt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-claims-'))
  try {
    const claims = loadTypeScript('src/lib/execution-claims.ts', {}, directory)
    const receipt = claims.claimExecution('rule-request:sample:request-1')
    const lock = claims.claimExecution('rule-lock:sample')
    assert.equal(claims.claimExecution('rule-lock:sample').claimed, false)
    claims.finishExecution(receipt.record, 'success')
    claims.finishExecution(lock.record, 'success')
    claims.releaseExecution(lock.record)
    assert.equal(claims.claimExecution('rule-lock:sample').claimed, true)
    assert.equal(claims.claimExecution('rule-request:sample:request-1').claimed, false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function approvalHarness(sql, engine = 'postgresql', execution = { status: 'verified', output: 'Confirmed' }) {
  class NextResponse {
    static json(body, options) { return { body, status: options?.status ?? 200 } }
  }
  const proposal = {
    id: 'proposal-1', status: 'pending', dbId: 'db-1', dbName: 'sample', engine,
    sql, actionType: 'analyze', proposedAction: 'Analyze tables',
  }
  const audit = []
  let claimed = false
  const route = loadTypeScript('src/app/api/autonomous/[id]/approve/route.ts', {
    'next/server': { NextResponse },
    '@/lib/auth': { requireRole: async () => ({ email: 'editor@example.test' }), getSessionFromRequest: async () => ({ email: 'editor@example.test' }) },
    '@/lib/automation-store': { loadProposals: () => [proposal], saveProposal: updated => Object.assign(proposal, updated) },
    '@/lib/db-store': { loadDatabases: () => [{ id: 'db-1', name: 'sample', engine }] },
    '@/lib/maintenance-policy': policy,
    '@/lib/maintenance-executor': { executeMaintenance: async (_db, action, statement) =>
      policy.permittedMaintenanceSql(engine, action, statement) ? execution : { status: 'advisory', output: 'Manual action required' } },
    '@/lib/execution-claims': {
      claimExecution: key => {
        const record = { key, id: 'claim-1', state: 'running' }
        if (claimed) return { claimed: false, record }
        claimed = true
        return { claimed: true, record }
      },
      finishExecution: () => {},
    },
    '@/lib/audit-store': { appendAudit: entry => audit.push(entry) },
  })
  return {
    proposal, audit,
    approve: () => route.POST({ json: async () => ({ confirm: true }) }, { params: Promise.resolve({ id: proposal.id }) }),
  }
}

test('advisory approval does not claim execution', async () => {
  const harness = approvalHarness('')
  const result = await harness.approve()
  assert.equal(result.body.status, 'approved')
  assert.equal(harness.proposal.status, 'approved')
  assert.equal(harness.proposal.executedAt, undefined)
  assert.equal(harness.audit[0].action, 'autonomous.review')
})

test('unsupported engine remains advisory', async () => {
  const harness = approvalHarness('ANALYZE public.orders;', 'redis')
  const result = await harness.approve()
  assert.equal(result.body.status, 'approved')
  assert.equal(harness.proposal.executedAt, undefined)
})

test('successful database action is recorded as executed', async () => {
  const harness = approvalHarness('ANALYZE public.orders;')
  const result = await harness.approve()
  assert.equal(result.body.status, 'executed')
  assert.ok(harness.proposal.executedAt)
  assert.equal(harness.audit[0].action, 'autonomous.execute')
})

test('unverified database outcomes require investigation', async () => {
  const harness = approvalHarness('ANALYZE public.orders;', 'postgresql', { status: 'unverified', output: 'Outcome unknown' })
  const result = await harness.approve()
  assert.equal(result.status, 422)
  assert.equal(result.body.status, 'unverified')
  assert.equal(harness.proposal.executedAt, undefined)
})

test('a repeated proposal request cannot run a second time', async () => {
  const harness = approvalHarness('ANALYZE public.orders;')
  assert.equal((await harness.approve()).body.status, 'executed')
  const second = await harness.approve()
  assert.equal(second.status, 400)
})

test('PostgreSQL ANALYZE is verified by advancing table statistics', async () => {
  let checks = 0
  const pool = {
    query: async sql => {
      if (sql.includes('pg_stat_all_tables')) return { rows: [{ last_analyze: checks++ ? '2026-09-30T01:00:00Z' : '2026-09-29T01:00:00Z' }] }
      return { rows: [] }
    },
    connect: async () => ({ query: async () => ({}), release: () => {} }),
  }
  const executor = loadTypeScript('src/lib/maintenance-executor.ts', {
    './db-connections': { getPgPool: async () => pool, getMysqlPool: async () => null },
    './maintenance-policy': policy,
  })
  const result = await executor.executeMaintenance({ engine: 'postgresql', name: 'sample' }, 'analyze', 'ANALYZE public.orders;')
  assert.equal(result.status, 'verified')
})

test('PostgreSQL ANALYZE with unchanged statistics is not reported successful', async () => {
  const pool = {
    query: async sql => sql.includes('pg_stat_all_tables')
      ? { rows: [{ last_analyze: '2026-09-29T01:00:00Z' }] } : { rows: [] },
    connect: async () => ({ query: async () => ({}), release: () => {} }),
  }
  const executor = loadTypeScript('src/lib/maintenance-executor.ts', {
    './db-connections': { getPgPool: async () => pool, getMysqlPool: async () => null },
    './maintenance-policy': policy,
  })
  const result = await executor.executeMaintenance({ engine: 'postgresql', name: 'sample' }, 'analyze', 'ANALYZE public.orders;')
  assert.equal(result.status, 'unverified')
})

test('MySQL ANALYZE needs an OK response', async () => {
  const executor = loadTypeScript('src/lib/maintenance-executor.ts', {
    './db-connections': { getPgPool: async () => null, getMysqlPool: async () => ({ execute: async () => [[{ Msg_type: 'error', Msg_text: 'permission denied' }]] }) },
    './maintenance-policy': policy,
  })
  const result = await executor.executeMaintenance({ engine: 'mysql', name: 'sample' }, 'analyze', 'ANALYZE TABLE orders;')
  assert.equal(result.status, 'unverified')
})

test('MySQL ANALYZE returns verified only for OK response', async () => {
  let statement
  const executor = loadTypeScript('src/lib/maintenance-executor.ts', {
    './db-connections': { getPgPool: async () => null, getMysqlPool: async () => ({ execute: async options => {
      statement = options
      return [[{ Msg_type: 'status', Msg_text: 'OK' }]]
    } }) },
    './maintenance-policy': policy,
  })
  const result = await executor.executeMaintenance({ engine: 'mysql', name: 'sample' }, 'analyze', 'ANALYZE TABLE orders;')
  assert.equal(result.status, 'verified')
  assert.equal(statement.timeout, 60_000)
})

test('investigated rule lock can be resolved without replaying the original request', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-claims-'))
  try {
    const claims = loadTypeScript('src/lib/execution-claims.ts', {}, directory)
    const receipt = claims.claimExecution('rule-request:sample:request-2')
    const lock = claims.claimExecution('rule-lock:sample')
    claims.finishExecution(receipt.record, 'unverified', true)
    claims.finishExecution(lock.record, 'unverified', true)
    claims.resolveRuleLock('sample', 'Inspected table statistics and confirmed the action is no longer running')
    assert.equal(claims.claimExecution('rule-lock:sample').claimed, true)
    assert.equal(claims.claimExecution('rule-request:sample:request-2').claimed, false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('manual rule route rejects duplicate request IDs before executing twice', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-route-'))
  class NextResponse {
    static json(body, options) { return { body, status: options?.status ?? 200 } }
  }
  let executions = 0
  try {
    const claims = loadTypeScript('src/lib/execution-claims.ts', {}, directory)
    const route = loadTypeScript('src/app/api/automation/[id]/run/route.ts', {
      'next/server': { NextResponse },
      '@/lib/auth': { requireRole: async () => ({ email: 'editor@example.test' }) },
      '@/lib/automation-store': { loadRules: () => [{ id: 'rule-1', dbId: 'db-1', actions: [{ type: 'analyze', sql: 'ANALYZE public.orders;' }], runCount: 0 }],
        saveRule: () => {}, addRun: () => {} },
      '@/lib/db-store': { loadDatabases: () => [{ id: 'db-1', engine: 'postgresql' }] },
      '@/lib/maintenance-policy': policy,
      '@/lib/automation-runner': { runAutomationRule: async () => { executions++; return { status: 'success', dataQuality: 'real', output: 'Verified' } } },
      '@/lib/execution-claims': claims,
      '@/lib/audit-store': { appendAudit: () => {} },
    }, directory)
    const request = { json: async () => ({ requestId: '12345678-1234-1234-1234-123456789abc' }) }
    const params = { params: Promise.resolve({ id: 'rule-1' }) }
    assert.equal((await route.POST(request, params)).body.status, 'success')
    assert.equal((await route.POST(request, params)).status, 409)
    assert.equal(executions, 1)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('auto-execute API cannot enable unattended execution', async () => {
  class NextResponse {
    static json(body, options) { return { body, status: options?.status ?? 200 } }
  }
  const route = loadTypeScript('src/app/api/autonomous/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/auth': { requireRole: async () => ({ email: 'editor@example.test' }) },
  })
  const result = await route.PATCH({})
  assert.equal(result.status, 410)
})