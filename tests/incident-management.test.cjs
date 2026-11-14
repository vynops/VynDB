const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const http = require('node:http')
const net = require('node:net')
const { spawnSync } = require('node:child_process')

function loadTypeScript(file, mocks, cwd, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports, require: name => name in mocks ? mocks[name] : require(name),
    process: { cwd: () => cwd, pid: process.pid }, console: { error() {} }, Date, setTimeout,
    AbortSignal, URL, ...globals,
  }, { filename: file })
  return exports
}

test('failed channel delivery remains retryable and success survives restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-notify-'))
  try {
    let calls = 0
    const settings = { slackWebhookUrl: 'https://slack.invalid', teamsWebhookUrl: 'https://teams.invalid', customWebhookUrl: 'https://webhook.invalid', notifyCooldownMinutes: 30 }
    const mocks = { './settings-store': { getSettings: () => settings }, './incident-store': {}, './audit-store': {}, nodemailer: {} }
    const globals = { fetch: async () => ({ ok: ++calls % 2 === 0, status: 503 }) }
    const notifier = loadTypeScript('src/lib/notifier.ts', mocks, directory, globals)
    for (const channel of ['sendSlack', 'sendTeams', 'sendWebhook']) {
      const payload = channel === 'sendWebhook' ? { incidentId: 'test-1' } : 'Test incident'
      assert.equal(await notifier[channel](payload), 'failed')
      assert.equal(await notifier[channel](payload), 'sent')
      const restarted = loadTypeScript('src/lib/notifier.ts', mocks, directory, globals)
      assert.equal(await restarted[channel](payload), 'skipped')
    }
    assert.equal(calls, 6)
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'data', 'notification-log.json'))).length, 6)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('email cooldown includes recipients and failed delivery can retry', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-email-'))
  try {
    let calls = 0
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => ({ alertEmailEnabled: true, smtpHost: 'smtp.invalid', notifyCooldownMinutes: 30 }) },
      './incident-store': {}, './audit-store': {},
      nodemailer: { createTransport: () => ({ sendMail: async () => { if (++calls === 1) throw new Error('Temporary transport failure'); return { rejected: [] } } }) },
    }, directory)
    assert.equal(await notifier.sendEmail(['first@example.invalid'], 'Incident', 'Open'), 'failed')
    assert.equal(await notifier.sendEmail(['first@example.invalid'], 'Incident', 'Open'), 'sent')
    assert.equal(await notifier.sendEmail(['second@example.invalid'], 'Incident', 'Open'), 'sent')
    assert.equal(await notifier.sendEmail(['first@example.invalid'], 'Incident', 'Open'), 'skipped')
    assert.equal(calls, 3)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('incident deliveries retry only failed channels and persist correlated audit outcomes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-routing-'))
  try {
    const audit = []
    const calls = { slack: 0, teams: 0, email: 0 }
    const settings = { slackWebhookUrl: 'https://slack.invalid', teamsWebhookUrl: 'https://teams.invalid', alertEmailEnabled: true, smtpHost: 'smtp.invalid', notifyCooldownMinutes: 30 }
    const mocks = {
      './settings-store': { getSettings: () => settings },
      './incident-store': { currentOnCallEmails: () => ['oncall@example.invalid'] },
      './audit-store': { appendAudit: entry => audit.push(entry) },
      nodemailer: { createTransport: () => ({ sendMail: async () => { calls.email++; return { rejected: [] } } }) },
    }
    const globals = { fetch: async url => {
      const channel = url.includes('slack') ? 'slack' : 'teams'
      calls[channel]++
      return { ok: channel === 'slack' || calls.teams > 1, status: 503 }
    } }
    const incident = { id: 'test-1', title: 'Unavailable', severity: 'critical', dbName: 'test', category: 'availability' }
    const targets = { notifySlack: true, notifyTeams: true, notifyOncall: true, notifyEmails: [], notifyWebhook: false }
    const first = loadTypeScript('src/lib/notifier.ts', mocks, directory, globals)
    assert.equal(await first.notifyIncident(incident, targets), false)
    const restarted = loadTypeScript('src/lib/notifier.ts', mocks, directory, globals)
    assert.equal(await restarted.notifyIncident(incident, targets), true)
    assert.deepEqual(calls, { slack: 1, teams: 2, email: 1 })
    assert.equal(audit.length, 4)
    assert.equal(audit.filter(entry => !entry.success).length, 1)
    assert.ok(audit.every(entry => entry.resourceId === 'test-1'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('incident delivery distinguishes disabled and misconfigured channels and deduplicates sends', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-channel-outcomes-'))
  try {
    const audit = []
    const calls = { slack: 0, email: 0 }
    const settings = { slackWebhookUrl: '', alertEmailEnabled: true, smtpHost: '', notifyCooldownMinutes: 0 }
    let oncall = []
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => settings },
      './incident-store': { currentOnCallEmails: () => oncall },
      './audit-store': { appendAudit: entry => audit.push(entry) },
      nodemailer: { createTransport: () => ({ sendMail: async () => { calls.email++; return { rejected: [] } } }) },
    }, directory, { fetch: async () => { calls.slack++; return { ok: true, status: 200 } } })
    const incident = { id: 'test-1', title: 'Unavailable', severity: 'critical', status: 'open', dbName: 'test', category: 'availability' }
    const targets = { notifySlack: true, notifyTeams: false, notifyWebhook: false, notifyEmails: ['general@example.invalid'], notifyOncall: true }
    const blocked = await notifier.notifyIncidentDetailed(incident, targets, 'escalation:test:0')
    assert.equal(blocked.complete, false)
    assert.equal(JSON.stringify(blocked.channels.map(channel => channel.outcome)), JSON.stringify([
      'configuration_error', 'not_applicable', 'not_applicable', 'configuration_error', 'configuration_error',
    ]))
    const disabled = await notifier.notifyIncidentDetailed(incident, {
      notifySlack: false, notifyTeams: false, notifyWebhook: false, notifyEmails: [], notifyOncall: false,
    }, 'disabled')
    assert.equal(disabled.complete, false)
    assert.ok(disabled.channels.every(channel => channel.outcome === 'not_applicable'))
    settings.slackWebhookUrl = 'https://slack.invalid'
    settings.smtpHost = 'smtp.invalid'
    oncall = ['oncall@example.invalid']
    const delivered = await notifier.notifyIncidentDetailed(incident, targets, 'escalation:test:0')
    assert.equal(delivered.complete, true)
    assert.equal(delivered.channels.filter(channel => channel.outcome === 'sent').length, 3)
    await notifier.notifyIncidentDetailed(incident, targets, 'escalation:test:0')
    assert.deepEqual(calls, { slack: 1, email: 2 })
    assert.ok(audit.every(entry => !JSON.stringify(entry).includes('slack.invalid') && !JSON.stringify(entry).includes('smtp.invalid')))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('changed delivery targets get new receipts while unchanged channels stay deduplicated', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-target-receipts-'))
  try {
    const calls = { slack: 0, teams: 0, email: 0 }
    const settings = { slackWebhookUrl: 'https://slack-a.invalid', teamsWebhookUrl: 'https://teams.invalid', alertEmailEnabled: true, smtpHost: '', notifyCooldownMinutes: 30 }
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => settings },
      './incident-store': { currentOnCallEmails: () => [] },
      './audit-store': { appendAudit() {} },
      nodemailer: { createTransport: () => ({ sendMail: async () => { calls.email++; return { rejected: [] } } }) },
    }, directory, { fetch: async url => {
      if (url.includes('slack-a') || url.includes('slack-b')) calls.slack++
      else calls.teams++
      return { ok: true, status: 200 }
    } })
    const incident = { id: 'target-test', title: 'Unavailable', severity: 'critical', status: 'open', dbName: 'test', category: 'availability' }
    const targets = { notifySlack: true, notifyTeams: true, notifyWebhook: false, notifyEmails: ['old@example.invalid'], notifyOncall: false }
    const blocked = await notifier.notifyIncidentDetailed(incident, targets, 'escalation:test:0')
    assert.equal(blocked.complete, false)
    assert.equal(calls.slack, 1)
    assert.equal(calls.teams, 1)

    settings.slackWebhookUrl = 'https://slack-b.invalid'
    settings.smtpHost = 'smtp.invalid'
    targets.notifyEmails = ['new@example.invalid']
    const recovered = await notifier.notifyIncidentDetailed(incident, targets, 'escalation:test:0')
    assert.equal(recovered.complete, true)
    assert.deepEqual(calls, { slack: 2, teams: 1, email: 1 })
    await notifier.notifyIncidentDetailed(incident, targets, 'escalation:test:0')
    assert.deepEqual(calls, { slack: 2, teams: 1, email: 1 })
    const receipts = fs.readFileSync(path.join(directory, 'data', 'incident-deliveries.json'), 'utf8')
    assert.ok(!receipts.includes('slack-b.invalid') && !receipts.includes('smtp.invalid') && !receipts.includes('new@example.invalid'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('background monitoring detects, routes, retries, escalates and retains lifecycle history without a browser', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-lifecycle-'))
  try {
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    const store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    assert.equal(store.loadIncidents().length, 0)
    const settings = { slackWebhookUrl: 'https://slack.invalid', notifyCooldownMinutes: 0, backupRpoBreachAlertHrs: Infinity }
    store.saveRouting([{ id: 'critical', severity: 'critical', category: 'availability', notifySlack: true, notifyTeams: false, notifyWebhook: false, notifyOncall: false, notifyEmails: [], escalationPolicyId: 'critical' }])
    store.saveEscalations([{ id: 'critical', steps: [{ delayMin: 0, notifySlack: true, notifyEmails: [], notifyOncall: false }] }])
    let fail = true
    let calls = 0
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => settings }, './incident-store': store, './audit-store': audit, nodemailer: {},
    }, directory, { fetch: async () => { calls++; return { ok: !fail, status: fail ? 503 : 200 } } })
    let now = Date.now() + 60_000
    class TestDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])) }
      static now() { return now }
    }
    const db = { id: 'db-test', name: 'test', engine: 'postgresql', status: 'error', lastChecked: new Date().toISOString() }
    const monitor = loadTypeScript('src/lib/monitor.ts', {
      './db-store': { loadDatabases: () => [db], loadSlowQueries: () => [], loadCapacity: () => [], loadReplication: () => [] },
      './automation-store': { loadRules: () => [], loadProposals: () => [] },
      './incident-store': store, './notifier': notifier, './settings-store': { getSettings: () => settings },
      './audit-store': audit, './status-freshness': { isStatusStale: () => false },
    }, directory, { Date: TestDate })
    assert.equal((await monitor.runMonitor()).incidentsRaised, 1)
    const incident = store.loadIncidents()[0]
    assert.equal(incident.severity, 'critical')
    const pending = JSON.parse(fs.readFileSync(path.join(directory, 'data', 'escalation-state.json')))
    assert.equal(pending[`${incident.id}:critical:0`].outcome, 'retrying')
    assert.ok(audit.loadAuditLog().some(entry => entry.action === 'incident.escalate' && !entry.success))
    fail = false
    now = Date.parse(pending[`${incident.id}:critical:0`].nextRetryAt)
    assert.equal((await monitor.runMonitor()).incidentsRaised, 0)
    assert.equal(calls, 4)
    await monitor.runMonitor()
    assert.equal(calls, 4)
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, 'data', 'escalation-state.json')))).length, 1)
    store.patchIncident(incident.id, { status: 'acknowledged', acknowledgedAt: '1999-01-01' }, 'test-editor')
    assert.ok(Date.parse(store.loadIncidents()[0].acknowledgedAt) > Date.parse('2026-01-01'))
    store.patchIncident(incident.id, { assignedTo: 'test-owner', notes: 'Investigating' }, 'test-editor')
    store.patchIncident(incident.id, { status: 'resolved', resolvedAt: '1999-01-01' }, 'test-editor')
    db.status = 'connected'
    fail = true
    await monitor.runMonitor()
    assert.equal(calls, 6)
    fail = false
    await monitor.runMonitor()
    assert.equal(calls, 8)
    await monitor.runMonitor()
    assert.equal(calls, 8)
    const restarted = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    assert.equal(restarted.loadIncidents()[0].status, 'resolved')
    assert.ok(Date.parse(restarted.loadIncidents()[0].resolvedAt) > Date.parse('2026-01-01'))
    const history = audit.loadAuditLog().filter(entry => entry.resourceId === incident.id)
    assert.equal(history.filter(entry => entry.action === 'incident.create').length, 1)
    assert.equal(history.filter(entry => entry.action === 'incident.update').length, 3)
    assert.ok(history.some(entry => entry.action === 'incident.notify' && entry.success))
    restarted.patchIncident(incident.id, { status: 'open' }, 'test-editor')
    assert.equal(restarted.loadIncidents()[0].acknowledgedAt, undefined)
    assert.equal(restarted.loadIncidents()[0].resolvedAt, undefined)
    await monitor.runMonitor()
    assert.equal(calls, 10)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('incident API enforces roles and records create, assignment, acknowledgement and resolution', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-api-'))
  try {
    class NextResponse {
      constructor(body, status) { this.body = body; this.status = status }
      static json(body, options) { return new NextResponse(body, options?.status ?? 200) }
    }
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    const store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    let denied = false
    let delivered = false
    const mocks = {
      'next/server': { NextResponse },
      '@/lib/auth': { requireRole: async () => denied ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : { email: 'test-editor' } },
      '@/lib/incident-store': store,
      '@/lib/notifier': { notifyIncident: async () => { await Promise.resolve(); delivered = true; return true } },
    }
    const api = loadTypeScript('src/app/api/incidents/route.ts', mocks, directory)
    const update = loadTypeScript('src/app/api/incidents/[id]/route.ts', mocks, directory)
    const input = { dbId: 'test', dbName: 'test', title: 'Failure', severity: 'high', category: 'availability', source: 'manual' }
    denied = true
    assert.equal((await api.POST({ json: async () => input })).status, 403)
    assert.equal(store.loadIncidents().length, 0)
    denied = false
    assert.equal((await api.POST({ json: async () => ({ ...input, severity: 'invalid' }) })).status, 400)
    const created = await api.POST({ json: async () => ({ ...input, id: 'spoofed', createdAt: '1999-01-01', status: 'resolved' }) })
    assert.equal(created.status, 201)
    assert.equal(delivered, true)
    assert.notEqual(created.body.id, 'spoofed')
    assert.equal(created.body.status, 'open')
    const params = { params: Promise.resolve({ id: created.body.id }) }
    assert.equal((await update.PATCH({ json: async () => ({ id: 'spoofed' }) }, params)).status, 400)
    assert.equal((await update.PATCH({ json: async () => ({ notes: {} }) }, params)).status, 400)
    assert.equal((await update.PATCH({ json: async () => ({ assignedTo: 'owner', notes: 'Investigation' }) }, params)).status, 200)
    const acknowledged = await update.PATCH({ json: async () => ({ status: 'acknowledged', acknowledgedAt: '1999-01-01' }) }, params)
    assert.ok(Date.parse(acknowledged.body.acknowledgedAt) > Date.parse('2026-01-01'))
    const resolved = await update.PATCH({ json: async () => ({ status: 'resolved', resolvedAt: '1999-01-01' }) }, params)
    assert.ok(Date.parse(resolved.body.resolvedAt) > Date.parse('2026-01-01'))
    assert.equal((await api.GET({ url: 'http://test.invalid/api/incidents?status=resolved' })).body.length, 1)
    assert.equal(audit.loadAuditLog().length, 4)
    assert.ok(audit.loadAuditLog().every(entry => entry.actor === 'test-editor' && entry.resourceId === created.body.id))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('default critical SLA breaches after 15 minutes and breach history is not duplicated', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-sla-'))
  try {
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    const store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    const incident = store.addIncident({ dbId: 'test', dbName: 'test', title: 'Failure', severity: 'critical', category: 'availability', source: 'manual', status: 'open' }, 'test-editor')
    store.saveIncidents([{ ...incident, createdAt: new Date(Date.now() - 20 * 60_000).toISOString() }])
    store.saveEscalations([])
    const monitor = loadTypeScript('src/lib/monitor.ts', {
      './db-store': { loadDatabases: () => [], loadSlowQueries: () => [], loadCapacity: () => [], loadReplication: () => [] },
      './automation-store': { loadRules: () => [], loadProposals: () => [] },
      './incident-store': store, './notifier': {
        notifyIncident: async () => true,
        notifyIncidentDetailed: async () => ({ complete: true, channels: [{ channel: 'slack', outcome: 'sent' }] }),
      },
      './settings-store': { getSettings: () => ({}) }, './audit-store': audit, './status-freshness': { isStatusStale: () => false },
    }, directory)
    await monitor.runMonitor()
    await monitor.runMonitor()
    assert.equal(store.loadIncidents()[0].slaBreach, true)
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.sla_breach').length, 1)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('overlapping incident notifications preserve both persistent receipts', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-overlap-'))
  try {
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => ({ slackWebhookUrl: 'https://slack.invalid', notifyCooldownMinutes: 0 }) },
      './incident-store': {}, './audit-store': { appendAudit() {} }, nodemailer: {},
    }, directory, { fetch: async () => { await Promise.resolve(); return { ok: true } } })
    const targets = { notifySlack: true, notifyTeams: false, notifyWebhook: false, notifyOncall: false, notifyEmails: [] }
    const incident = { title: 'Test', severity: 'critical', dbName: 'test', category: 'availability' }
    await Promise.all(['first', 'second'].map(id => notifier.notifyIncident({ ...incident, id }, targets)))
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, 'data', 'incident-deliveries.json')))).length, 2)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('replication, connection pool, capacity and backup incidents all receive initial routing and creation audit', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-categories-'))
  try {
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    const store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    store.saveIncidents([])
    store.saveEscalations([])
    const timestamp = new Date().toISOString()
    fs.writeFileSync(path.join(directory, 'data', 'perf-snapshots.json'), JSON.stringify([{ dbId: 'test', timestamp, activeConnections: 100, maxConnections: 100 }]))
    const notified = []
    const monitor = loadTypeScript('src/lib/monitor.ts', {
      './db-store': {
        loadDatabases: () => [{ id: 'test', name: 'test', status: 'connected', engine: 'postgresql' }],
        loadSlowQueries: () => [],
        loadCapacity: () => [{ dbId: 'test', dbName: 'test', totalSizeMB: 9500, freeSizeMB: 500, collectedAt: timestamp }],
        loadReplication: () => [{ dbId: 'test-replica', dbName: 'replica', role: 'replica', lagSeconds: 61, collectedAt: timestamp }],
      },
      './automation-store': { loadRules: () => [], loadProposals: () => [], saveProposal() {}, newProposalId: () => 'test-proposal' },
      './incident-store': store, './notifier': {
        notifyIncident: async (incident, route) => { notified.push({ category: incident.category, severity: incident.severity, routeSeverity: route.severity }); return true },
        notifyIncidentDetailed: async () => ({ complete: true, channels: [{ channel: 'slack', outcome: 'sent' }] }),
      },
      './settings-store': { getSettings: () => ({ replicationLagAlertSec: 30, connectionPoolPctAlert: 80, backupRpoBreachAlertHrs: 1 }) },
      './audit-store': audit, './status-freshness': { isStatusStale: () => false },
    }, directory)
    assert.equal((await monitor.runMonitor()).incidentsRaised, 4)
    assert.deepEqual(notified.map(item => item.category).sort(), ['backup', 'capacity', 'performance', 'replication'])
    assert.ok(notified.every(item => item.severity === item.routeSeverity))
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.create').length, 4)
    assert.equal((await monitor.runMonitor()).incidentsRaised, 0)
    assert.equal(store.loadIncidents().length, 4)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('reopening an incident bypasses the previous cycle cooldown', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-reopen-'))
  try {
    let calls = 0
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => ({ slackWebhookUrl: 'https://slack.invalid', notifyCooldownMinutes: 30 }) },
      './incident-store': {}, './audit-store': { appendAudit() {} }, nodemailer: {},
    }, directory, { fetch: async () => { calls++; return { ok: true } } })
    const incident = { id: 'test', title: 'Failure', severity: 'critical', status: 'open', dbName: 'test', category: 'availability', createdAt: '2026-10-03T10:00:00Z' }
    const targets = { notifySlack: true, notifyTeams: false, notifyWebhook: false, notifyOncall: false, notifyEmails: [] }
    assert.equal(await notifier.notifyIncident(incident, targets), true)
    assert.equal(await notifier.notifyIncident({ ...incident, reopenedAt: '2026-10-03T10:01:00Z' }, targets), true)
    assert.equal(calls, 2)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('general email success does not fulfil missing on-call delivery, and new coverage retries', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-oncall-'))
  try {
    let oncall = []
    const sends = []
    const audit = []
    const notifier = loadTypeScript('src/lib/notifier.ts', {
      './settings-store': { getSettings: () => ({ alertEmailEnabled: true, smtpHost: 'smtp.invalid', notifyCooldownMinutes: 30 }) },
      './incident-store': { currentOnCallEmails: () => oncall },
      './audit-store': { appendAudit: entry => audit.push(entry) },
      nodemailer: { createTransport: () => ({ sendMail: async mail => { sends.push(mail.to); return { rejected: [] } } }) },
    }, directory)
    const incident = { id: 'test', title: 'Failure', severity: 'critical', status: 'open', dbName: 'test', category: 'availability' }
    const targets = { notifySlack: false, notifyTeams: false, notifyWebhook: false, notifyOncall: true, notifyEmails: ['general@example.invalid'] }
    assert.equal(await notifier.notifyIncident(incident, targets), false)
    assert.ok(audit.some(entry => !entry.success && entry.details.channel === 'oncall'))
    oncall = ['oncall@example.invalid']
    assert.equal(await notifier.notifyIncident(incident, targets), true)
    assert.deepEqual(sends, ['general@example.invalid', 'oncall@example.invalid'])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('escalation outcomes persist backoff, recover on configuration changes, and honor legacy completion', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-escalation-state-'))
  try {
    let now = Date.now()
    class TestDate extends Date {
      constructor(...args) { super(...(args.length ? args : [now])) }
      static now() { return now }
    }
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    const store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    const first = store.addIncident({ dbId: 'test', dbName: 'test', title: 'Backup delayed', severity: 'critical', category: 'backup', source: 'manual', status: 'open' })
    const legacy = store.addIncident({ dbId: 'test', dbName: 'test', title: 'Legacy backup delay', severity: 'critical', category: 'backup', source: 'manual', status: 'open' })
    store.saveIncidents(store.loadIncidents().map(item => ({ ...item, createdAt: new Date(now - 60_000).toISOString() })))
    store.saveRouting([{ id: 'test-route', severity: '*', category: '*', notifySlack: false, notifyTeams: false, notifyWebhook: false, notifyOncall: false, notifyEmails: [], escalationPolicyId: 'test-policy' }])
    store.saveEscalations([{ id: 'test-policy', steps: [{ delayMin: 0, condition: 'unresolved', notifySlack: true, notifyTeams: false, notifyWebhook: false, notifyOncall: false, notifyEmails: [] }] }])
    const stateFile = path.join(directory, 'data', 'escalation-state.json')
    const legacyKey = `${legacy.id}:test-policy:0`
    fs.writeFileSync(stateFile, JSON.stringify({ [legacyKey]: new Date(now).toISOString() }))
    const settings = { slackWebhookUrl: '', backupRpoBreachAlertHrs: Infinity }
    let mode = 'configuration_error'
    let calls = 0
    const notifier = {
      notifyIncident: async () => true,
      notifyIncidentDetailed: async () => {
        calls++
        return { complete: mode === 'sent', channels: [{ channel: 'slack', outcome: mode }] }
      },
    }
    const makeMonitor = () => loadTypeScript('src/lib/monitor.ts', {
      './db-store': { loadDatabases: () => [], loadSlowQueries: () => [], loadCapacity: () => [], loadReplication: () => [] },
      './automation-store': { loadRules: () => [], loadProposals: () => [] },
      './incident-store': store, './notifier': notifier, './settings-store': { getSettings: () => settings },
      './audit-store': audit, './status-freshness': { isStatusStale: () => false },
    }, directory, { Date: TestDate })
    const run = async () => makeMonitor().runMonitor()
    const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'))[`${first.id}:test-policy:0`]

    await run()
    let state = readState()
    assert.equal(state.outcome, 'configuration_error')
    assert.equal(state.attempt, 1)
    assert.equal(calls, 1)
    const firstEscalation = audit.loadAuditLog().filter(entry => entry.action === 'incident.escalate')
    assert.equal(firstEscalation.length, 1)
    assert.equal(firstEscalation[0].resourceId, first.id)
    assert.equal(firstEscalation[0].success, false)
    assert.equal(JSON.stringify(firstEscalation[0].details), JSON.stringify({
      incidentId: first.id,
      incidentTitle: first.title,
      incidentSeverity: first.severity,
      incidentStatus: first.status,
      policy: 'test-policy',
      step: 0,
      outcome: 'configuration_error',
      attempt: 1,
      channels: [{ channel: 'slack', outcome: 'configuration_error' }],
    }))
    assert.ok(!JSON.stringify(state).includes('slackWebhookUrl'))
    await run()
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.escalate').length, 1)
    assert.equal(calls, 1)

    settings.smtpHost = 'unrelated-smtp'
    settings.smtpPassword = 'unrelated-secret'
    store.saveOncall([{ id: 'rotated-shift', userEmail: 'oncall@example.invalid', startTime: new Date(Date.now() - 60_000).toISOString(), endTime: new Date(Date.now() + 60 * 60_000).toISOString() }])
    await run()
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.escalate').length, 1)
    assert.equal(calls, 1)

    settings.slackWebhookUrl = 'configured'
    mode = 'failed'
    await run()
    state = readState()
    assert.equal(state.outcome, 'retrying')
    assert.equal(state.attempt, 1)
    assert.equal(Date.parse(state.nextRetryAt) - now, 5 * 60_000)
    const retryAt = Date.parse(state.nextRetryAt)
    await run()
    assert.equal(calls, 2)
    assert.equal(readState().attempt, 1)
    now = retryAt
    for (const [attempt, expectedDelay] of [[2, 10], [3, 20], [4, 30], [5, undefined]]) {
      await run()
      state = readState()
      assert.equal(state.attempt, attempt)
      assert.equal(state.outcome, attempt === 5 ? 'retry_exhausted' : 'retrying')
      if (expectedDelay) assert.equal(Date.parse(state.nextRetryAt) - now, expectedDelay * 60_000)
      else assert.equal(state.nextRetryAt, undefined)
      if (state.nextRetryAt) now = Date.parse(state.nextRetryAt)
    }
    const attemptsBeforeTerminalCheck = calls
    await run()
    assert.equal(calls, attemptsBeforeTerminalCheck)

    settings.slackWebhookUrl = 'corrected'
    mode = 'sent'
    await run()
    assert.equal(readState().outcome, 'sent')
    assert.equal(readState().attempt, 1)
    const attemptsAfterSuccess = calls
    await run()
    assert.equal(calls, attemptsAfterSuccess)
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.escalate' && entry.resourceId === legacy.id).length, 0)
    assert.ok(audit.loadAuditLog().filter(entry => entry.action === 'incident.escalate').every(entry => !JSON.stringify(entry.details).includes('configured')))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('acknowledgement stops reminders but not the standard unresolved escalation', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-escalation-'))
  try {
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    const store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    const incident = store.addIncident({ dbId: 'test', dbName: 'test', title: 'Failure', severity: 'medium', category: 'availability', source: 'manual', status: 'acknowledged', acknowledgedAt: new Date().toISOString() })
    store.saveIncidents([{ ...incident, createdAt: new Date(Date.now() - 90 * 60_000).toISOString() }])
    const events = []
    const monitor = loadTypeScript('src/lib/monitor.ts', {
      './db-store': { loadDatabases: () => [], loadSlowQueries: () => [], loadCapacity: () => [], loadReplication: () => [] },
      './automation-store': { loadRules: () => [], loadProposals: () => [] }, './incident-store': store,
      './notifier': {
        notifyIncident: async () => true,
        notifyIncidentDetailed: async (item, targets, key) => { events.push(key); return { complete: true, channels: [{ channel: 'slack', outcome: 'sent' }] } },
      },
      './settings-store': { getSettings: () => ({}) }, './audit-store': audit, './status-freshness': { isStatusStale: () => false },
    }, directory)
    await monitor.runMonitor()
    assert.ok(events.includes('escalation:default:1'))
    assert.ok(!events.includes('escalation:default:0'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('HTTP lifecycle uses JWT authorization, real webhook and SMTP transports, durable retry and history', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-http-e2e-'))
  const messages = []
  const sockets = new Set()
  const smtp = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setTimeout(5000, () => socket.destroy())
    socket.write('220 localhost test SMTP\r\n')
    let buffer = ''
    let data = null
    socket.on('data', chunk => {
      buffer += chunk.toString()
      let boundary
      while ((boundary = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (data !== null) {
          if (line === '.') { messages.push(data.join('\n')); data = null; socket.write('250 queued\r\n') }
          else data.push(line)
        } else if (/^EHLO/i.test(line)) socket.write('250-localhost\r\n250 PIPELINING\r\n')
        else if (/^DATA/i.test(line)) { data = []; socket.write('354 send message\r\n') }
        else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n')
        else socket.write('250 OK\r\n')
      }
    })
  })
  const deliveries = []
  const requestErrors = []
  let failWebhook = true
  let api
  let update
  let monitor
  const receiver = http.createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      if (!request.url.startsWith('/api/')) {
        deliveries.push({ channel: request.url, payload: JSON.parse(body.toString()) })
        response.writeHead(request.url === '/webhook' && failWebhook ? 503 : 200)
        response.end('ok')
        return
      }
      const { NextRequest, NextResponse } = require('next/server')
      const nextRequest = new NextRequest(`http://127.0.0.1${request.url}`, { method: request.method, headers: request.headers, ...(body.length ? { body } : {}) })
      let result
      if (request.url === '/api/monitor') result = await monitor.POST(nextRequest)
      else if (request.url.startsWith('/api/incidents/')) result = await update.PATCH(nextRequest, { params: Promise.resolve({ id: request.url.split('/')[3] }) })
      else result = await api[request.method](nextRequest)
      assert.ok(result instanceof NextResponse)
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(await result.text())
    } catch (error) {
      requestErrors.push({ name: error.name, code: error.code ?? null, location: /src\/[^:\s]+:\d+:\d+/.exec(error.stack || '')?.[0] ?? null })
      response.writeHead(500)
      response.end('{}')
    }
  })
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await listen(smtp)
    await listen(receiver)
    const base = `http://127.0.0.1:${receiver.address().port}`
    const env = { VYNDB_SECRET: require('node:crypto').randomBytes(32).toString('hex'), VYNDB_COLLECTOR_TOKEN: require('node:crypto').randomBytes(32).toString('hex') }
    const globals = { fetch, TextEncoder, process: { cwd: () => directory, pid: process.pid, env } }
    const users = [{ id: 'editor', email: 'editor@example.invalid', name: 'Editor', role: 'editor', active: true }, { id: 'viewer', email: 'viewer@example.invalid', name: 'Viewer', role: 'viewer', active: true }]
    const auth = loadTypeScript('src/lib/auth.ts', { './user-store': { findUserById: id => users.find(user => user.id === id) } }, directory, globals)
    const audit = loadTypeScript('src/lib/audit-store.ts', {}, directory)
    let store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
    const settings = loadTypeScript('src/lib/settings-store.ts', {}, directory, globals)
    settings.saveSettings({ slackWebhookUrl: `${base}/slack`, teamsWebhookUrl: `${base}/teams`, customWebhookUrl: `${base}/webhook`, alertEmailEnabled: true, smtpHost: '127.0.0.1', smtpPort: smtp.address().port, smtpFrom: 'alerts@example.invalid', smtpUser: '', notifyCooldownMinutes: 30 })
    store.saveIncidents([])
    store.saveOncall([{ id: 'test-shift', userEmail: 'oncall@example.invalid', startTime: new Date(Date.now() - 60000).toISOString(), endTime: new Date(Date.now() + 3600000).toISOString() }])
    store.saveRouting([{ id: 'test-route', severity: '*', category: '*', notifySlack: true, notifyTeams: true, notifyWebhook: true, notifyOncall: true, notifyEmails: ['general@example.invalid'], escalationPolicyId: 'test-policy' }])
    store.saveEscalations([{ id: 'test-policy', steps: [{ delayMin: 0, condition: 'unacknowledged', notifySlack: true, notifyOncall: false, notifyEmails: [] }] }])
    function restart() {
      store = loadTypeScript('src/lib/incident-store.ts', { './audit-store': audit }, directory)
      const notifier = loadTypeScript('src/lib/notifier.ts', { './incident-store': store, './audit-store': audit, './settings-store': settings }, directory, globals)
      const routes = { '@/lib/auth': auth, '@/lib/incident-store': store, '@/lib/notifier': notifier }
      api = loadTypeScript('src/app/api/incidents/route.ts', routes, directory, globals)
      update = loadTypeScript('src/app/api/incidents/[id]/route.ts', routes, directory, globals)
      const worker = loadTypeScript('src/lib/monitor.ts', {
        './incident-store': store, './notifier': notifier, './audit-store': audit, './settings-store': settings,
        './db-store': { loadDatabases: () => [], loadSlowQueries: () => [], loadCapacity: () => [], loadReplication: () => [] },
        './automation-store': { loadRules: () => [], loadProposals: () => [] }, './status-freshness': { isStatusStale: () => false },
      }, directory, globals)
      monitor = loadTypeScript('src/app/api/monitor/route.ts', { '@/lib/monitor': worker }, directory, globals)
    }
    restart()
    const editorToken = await auth.createSession(users[0])
    const viewerToken = await auth.createSession(users[1])
    const request = (endpoint, method = 'GET', body, token = editorToken) => fetch(base + endpoint, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `${auth.sessionCookieName()}=${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const input = { dbId: 'test', dbName: 'test', title: 'Test incident', severity: 'critical', category: 'availability', source: 'auto' }
    assert.equal((await request('/api/incidents', 'GET', undefined, '')).status, 401)
    assert.equal((await request('/api/incidents', 'POST', input, viewerToken)).status, 403)
    assert.equal((await request('/api/monitor', 'POST', {})).status, 401)
    const createdResponse = await request('/api/incidents', 'POST', input)
    assert.equal(createdResponse.status, 201)
    const incident = await createdResponse.json()
    assert.equal(deliveries.length, 3)
    assert.equal(messages.length, 2)
    assert.ok(messages.some(message => message.includes('oncall@example.invalid')))
    const duplicate = await request('/api/incidents', 'POST', input)
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.headers.get('X-VynDB-Deduplicated'), 'true')
    assert.equal(deliveries.length, 3)
    failWebhook = false
    restart()
    const tick = () => fetch(`${base}/api/monitor`, { method: 'POST', headers: { Authorization: `Bearer ${env.VYNDB_COLLECTOR_TOKEN}` } })
    assert.equal((await tick()).status, 200)
    assert.equal(deliveries.filter(item => item.channel === '/teams').length, 1)
    assert.equal(deliveries.filter(item => item.channel === '/webhook').length, 2)
    assert.equal(messages.length, 2)
    const delivered = deliveries.length
    await tick()
    assert.equal(deliveries.length, delivered)
    const endpoint = `/api/incidents/${incident.id}`
    for (const invalid of [null, [], true]) {
      assert.equal((await request('/api/incidents', 'POST', invalid)).status, 400)
      assert.equal((await request(endpoint, 'PATCH', invalid)).status, 400)
    }
    assert.equal((await fetch(base + endpoint, { method: 'PATCH', headers: { Cookie: `${auth.sessionCookieName()}=${editorToken}`, 'Content-Type': 'application/json' }, body: '{' })).status, 400)
    assert.equal((await request(endpoint, 'PATCH', { assignedTo: 'owner', notes: 'Investigating' })).status, 200, JSON.stringify(requestErrors))
    const acknowledged = await request(endpoint, 'PATCH', { status: 'acknowledged', acknowledgedAt: '1999-01-01' })
    assert.equal(acknowledged.status, 200)
    assert.ok(Date.parse((await acknowledged.json()).acknowledgedAt) > Date.parse('2026-01-01'))
    failWebhook = true
    assert.equal((await request(endpoint, 'PATCH', { status: 'resolved' })).status, 200)
    failWebhook = false
    restart()
    assert.equal((await tick()).status, 200)
    assert.ok(deliveries.some(item => item.channel === '/webhook' && item.payload.status === 'resolved'))
    const stable = deliveries.length
    const stableEmailCount = messages.length
    await tick()
    assert.equal(deliveries.length, stable)
    assert.equal(messages.length, stableEmailCount)
    const resolved = await request('/api/incidents?status=resolved')
    assert.equal((await resolved.json()).length, 1)
    assert.equal((await request(endpoint, 'PATCH', { status: 'open' })).status, 200)
    assert.ok(deliveries.length > stable)
    const reopenedDeliveries = deliveries.length
    await tick()
    assert.equal(deliveries.length, reopenedDeliveries + 1)
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.create').length, 1)
    assert.equal(audit.loadAuditLog().filter(entry => entry.action === 'incident.update').length, 4)
    assert.ok(audit.loadAuditLog().some(entry => entry.action === 'incident.notify' && !entry.success))
    users[0].active = false
    assert.equal((await request('/api/incidents')).status, 401)
  } finally {
    receiver.closeAllConnections()
    for (const socket of sockets) socket.destroy()
    await Promise.all([new Promise(resolve => receiver.close(resolve)), new Promise(resolve => smtp.close(resolve))])
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('scheduled script monitors after collection failure and reports failed cycles', context => {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs/Git/bin/bash.exe')]
    : ['/bin/bash', '/usr/bin/bash']
  const bash = candidates.find(candidate => fs.existsSync(candidate))
  if (!bash) { context.skip('Bash unavailable; scheduled script execution not verified'); return }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vyndb-scheduler-'))
  try {
    fs.mkdirSync(path.join(directory, 'scripts'))
    const script = path.join(directory, 'scripts', 'trigger-collect.sh')
    fs.copyFileSync(path.join(__dirname, '..', 'scripts', 'trigger-collect.sh'), script)
    const shellPath = process.platform === 'win32' ? script.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`) : script
    const command = `curl() {
      case "$*" in
        *api/collect*) printf '%s' "$VYNDB_TEST_COLLECT_CODE" ;;
        *api/monitor*) printf '{"ok":true}\\n%s' "$VYNDB_TEST_MONITOR_CODE" ;;
        *api/backup-schedules/execute-due*) printf '{"ok":true}\\n200' ;;
        *) return 1 ;;
      esac
    }
    export -f curl
    exec bash "$VYNDB_TEST_SCRIPT"`
    for (const [collectCode, monitorCode, expectedExit] of [['200', '200', 0], ['500', '200', 1], ['000', '200', 1], ['200', '503', 1]]) {
      const result = spawnSync(bash, ['-c', command], { encoding: 'utf8', timeout: 10000, env: { ...process.env, VYNDB_COLLECTOR_TOKEN: 'isolated-test', VYNDB_TEST_SCRIPT: shellPath, VYNDB_TEST_COLLECT_CODE: collectCode, VYNDB_TEST_MONITOR_CODE: monitorCode } })
      assert.match(result.stdout, new RegExp(`Monitor: HTTP ${monitorCode}`))
      assert.match(result.stdout, /Backup schedules: HTTP 200/)
      assert.equal(result.status, expectedExit)
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('rendered incident and SLA views use reopened clocks and include overdue resolution breaches', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const incident = { id: 'test', dbId: 'test', dbName: 'test', title: 'Test', severity: 'critical', category: 'availability', source: 'manual', status: 'open', createdAt: new Date(Date.now() - 200 * 60000).toISOString(), reopenedAt: new Date(Date.now() - 5 * 60000).toISOString() }
  let incidents = [incident]
  const sla = { critical: { ackMinutes: 15, resolveMinutes: 60 } }
  const mocks = {
    swr: url => ({ data: url === '/api/incidents' ? incidents : url === '/api/sla' ? sla : [], mutate() {} }),
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' '), timeAgo: () => 'test age' },
    '@/lib/use-app-refresh-interval': { useAppRefreshInterval: () => 0 },
  }
  const slaPage = loadTypeScript('src/app/(dashboard)/sla/page.tsx', mocks, process.cwd())
  assert.ok(!renderToStaticMarkup(React.createElement(slaPage.default)).includes('resolve breaches'))
  const incidentPage = loadTypeScript('src/app/(dashboard)/incidents/page.tsx', mocks, process.cwd())
  assert.match(renderToStaticMarkup(React.createElement(incidentPage.default)), />5m</)
  incidents = [{ ...incident, reopenedAt: undefined, createdAt: new Date(Date.now() - 70 * 60000).toISOString() }]
  assert.match(renderToStaticMarkup(React.createElement(slaPage.default)), /1 ack.*1 resolve breaches/)
})