const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
}

function loadRoute(provider, response) {
  const usage = []
  const errors = []
  class MockResponse {
    constructor(body, status = 200) { this.body = body; this.status = status }
    static json(body, options) { return new MockResponse(body, options?.status) }
  }
  class Provider {
    messages = { create: async () => response }
    chat = { completions: { create: async () => response } }
  }
  const empty = () => []
  const mocks = {
    'next/server': { NextResponse: MockResponse },
    '@/lib/auth': { requireRole: async () => ({}) },
    '@/lib/settings-store': { getSettings: () => ({ aiProvider: provider, aiApiKey: 'test-key', aiModel: 'test-model', aiBaseUrl: 'https://provider.example.invalid' }) },
    '@/lib/db-store': { loadDatabases: empty, loadSlowQueries: empty, loadCapacity: empty, loadReplication: empty, loadBackups: empty, loadSchema: empty },
    '@/lib/copilot-usage': { recordUsage: (...args) => usage.push(args) },
    '@/lib/incident-store': { loadIncidents: empty, loadOncall: empty, loadRouting: empty, loadSla: () => ({}) },
    '@/lib/automation-store': { loadRules: empty, loadProposals: empty },
    '@/lib/database-capabilities': {},
    '@/lib/status-freshness': {},
    fs: { existsSync: () => false },
    '@anthropic-ai/sdk': Provider,
    openai: Provider,
    'groq-sdk': Provider,
    '@google/generative-ai': { GoogleGenerativeAI: class {
      getGenerativeModel() { return { generateContent: async () => ({ response }) } }
    } },
  }
  const exports = {}
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/copilot/route.ts'), 'utf8')
  vm.runInNewContext(compile(source), {
    exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process: { cwd: () => '.', env: {} },
    console: { error: (...args) => errors.push(args) },
    fetch: async () => ({ ok: true, json: async () => response }),
  })
  return { post: () => exports.POST({ json: async () => ({ messages: [{ role: 'user', content: 'Help' }] }) }), usage, errors }
}

test('Anthropic preserves every text block, including after non-text blocks', async () => {
  const { post, usage, errors } = loadRoute('anthropic', {
    content: [{ type: 'thinking', thinking: 'not visible' }, { type: 'text', text: 'Evidence' }, { type: 'text', text: 'Verification' }],
    usage: { input_tokens: 40, output_tokens: 20 },
  })
  const result = await post()
  assert.equal(result.status, 200)
  assert.equal(result.body.content, 'Evidence\n\nVerification')
  assert.deepEqual(usage, [[40, 20, 'test-model', 'anthropic']])
  assert.equal(errors.length, 0)
})

test('empty replies from every provider fail visibly while preserving usage', async () => {
  for (const [provider, response] of [
    ['anthropic', { content: [{ type: 'thinking' }], usage: { input_tokens: 40, output_tokens: 20 } }],
    ['openai', { choices: [{ message: { content: null } }], usage: { prompt_tokens: 40, completion_tokens: 20 } }],
    ['groq', { choices: [{ message: { content: ' \n' } }], usage: { prompt_tokens: 40, completion_tokens: 20 } }],
    ['custom', { choices: [], usage: { prompt_tokens: 40, completion_tokens: 20 } }],
    ['google', { text: () => '', usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 20 } }],
  ]) {
    const { post, usage, errors } = loadRoute(provider, response)
    const result = await post()
    assert.equal(result.status, 502, provider)
    assert.match(result.body.error, /no visible text/)
    assert.equal(result.body.content, undefined)
    assert.deepEqual(usage, [[40, 20, 'test-model', provider]])
    assert.equal(errors.length, 1)
  }
})

test('ordinary provider text remains unchanged', async () => {
  const { post } = loadRoute('openai', { choices: [{ message: { content: 'Use EXPLAIN first.' } }] })
  const result = await post()
  assert.equal(result.status, 200)
  assert.equal(result.body.content, 'Use EXPLAIN first.')
})

async function sendFromPage(response) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app/(dashboard)/copilot/page.tsx'), 'utf8')
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let send
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'send') send = node.initializer.getText(ast)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(send)
  let messages = []
  let saved = false
  let loading = false
  const context = {
    input: 'Help', loading: false, messages: [], dbList: [],
    setInput() {},
    setMessages: value => { messages = typeof value === 'function' ? value(messages) : value },
    setLoading: value => { loading = value },
    saveSession: () => { saved = true },
    fetch: async () => response,
    Error,
  }
  vm.runInNewContext(compile(`const send = ${send}; exports.send = send`), { ...context, exports: context })
  await context.send()
  return { messages, saved, loading }
}

test('chat displays API errors and rejects blank or malformed successful replies', async () => {
  for (const [ok, status, body, expected] of [
    [false, 502, { error: 'AI provider returned no visible text.' }, /no visible text/],
    [false, 400, { error: 'Provider API key not configured.' }, /API key not configured/],
    [false, 503, {}, /503/],
    [true, 200, { content: '' }, /no visible text/],
    [true, 200, { content: ' \n' }, /no visible text/],
    [true, 200, { content: null }, /no visible text/],
    [true, 200, { content: {} }, /no visible text/],
  ]) {
    const result = await sendFromPage({ ok, status, json: async () => body })
    assert.match(result.messages.at(-1).content, expected)
    assert.equal(result.saved, false)
    assert.equal(result.loading, false)
  }
})

test('chat still displays and saves a valid answer', async () => {
  const result = await sendFromPage({ ok: true, json: async () => ({ content: 'Collect a query plan.' }) })
  assert.equal(result.messages.at(-1).content, 'Collect a query plan.')
  assert.equal(result.saved, true)
  assert.equal(result.loading, false)
})
