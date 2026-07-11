'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Plus, Edit2, Trash2, Wifi, WifiOff, ChevronDown, X, Loader2, CheckCircle, XCircle, Database, Terminal, Play, ChevronRight } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type DbEngine = 'postgresql' | 'mysql' | 'oracle' | 'sqlserver' | 'mongodb' | 'redis' | 'couchbase'
type DbEnv = 'production' | 'staging' | 'development' | 'test'

const ENGINES: { value: DbEngine; label: string; defaultPort: number }[] = [
  { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql',      label: 'MySQL / MariaDB', defaultPort: 3306 },
  { value: 'oracle',     label: 'Oracle', defaultPort: 1521 },
  { value: 'sqlserver',  label: 'SQL Server', defaultPort: 1433 },
  { value: 'mongodb',    label: 'MongoDB', defaultPort: 27017 },
  { value: 'redis',      label: 'Redis', defaultPort: 6379 },
  { value: 'couchbase',  label: 'CouchBase', defaultPort: 8091 },
]

const ENGINE_COLOR: Record<string, string> = {
  postgresql: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  mysql:      'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  oracle:     'text-red-400 bg-red-500/10 border-red-500/20',
  sqlserver:  'text-blue-400 bg-blue-500/10 border-blue-500/20',
  mongodb:    'text-green-400 bg-green-500/10 border-green-500/20',
  redis:      'text-orange-400 bg-orange-500/10 border-orange-500/20',
  couchbase:  'text-purple-400 bg-purple-500/10 border-purple-500/20',
}

const STATUS_BADGE: Record<string, string> = {
  connected: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  warning:   'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  error:     'bg-red-500/20 text-red-400 border border-red-500/30',
  unknown:   'bg-slate-500/20 text-slate-400 border border-slate-500/20',
}

const ENV_BADGE: Record<string, string> = {
  production:  'bg-red-500/10 text-red-400',
  staging:     'bg-yellow-500/10 text-yellow-400',
  development: 'bg-blue-500/10 text-blue-400',
  test:        'bg-slate-700 text-slate-400',
}

interface DbForm {
  name: string; engine: DbEngine; host: string; port: number; database: string;
  username: string; password: string; ssl: boolean; environment: DbEnv; notes: string;
}

const EMPTY_FORM: DbForm = {
  name: '', engine: 'postgresql', host: '', port: 5432, database: '',
  username: '', password: '', ssl: false, environment: 'production', notes: '',
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-emerald-500' : score >= 70 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 bg-slate-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-slate-400 font-bold">{score}</span>
    </div>
  )
}

function fmtSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`
  return `${Math.round(mb)}MB`
}
function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export default function DatabasesPage() {
  const { data: dbs, mutate } = useSWR('/api/databases', fetcher)
  const { data: perfList } = useSWR('/api/performance', fetcher, { refreshInterval: 30000 })
  const { data: capList } = useSWR('/api/capacity', fetcher, { refreshInterval: 60000 })
  const { data: replList } = useSWR('/api/replication', fetcher, { refreshInterval: 30000 })

  const dbList = Array.isArray(dbs) ? dbs : []

  // Lookup maps keyed by dbId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const perfByDb = Object.fromEntries((Array.isArray(perfList) ? perfList : []).map((s: any) => [s.dbId, s]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capByDb  = Object.fromEntries((Array.isArray(capList)  ? capList  : []).map((c: any) => [c.dbId, c]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replByDb = Object.fromEntries((Array.isArray(replList) ? replList : []).map((r: any) => [r.dbId, r]))

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<DbForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [envFilter, setEnvFilter] = useState<string>('all')

  // Query console state
  const [consoleDb, setConsoleDb] = useState<{ id: string; name: string; engine: DbEngine } | null>(null)
  const [consoleSql, setConsoleSql] = useState('')
  const [consoleRunning, setConsoleRunning] = useState(false)
  const [consoleResult, setConsoleResult] = useState<{ columns: string[]; rows: unknown[][]; rowCount: number; durationMs: number; error?: string } | null>(null)
  const [consoleHistory, setConsoleHistory] = useState<string[]>([])

  const PLACEHOLDERS: Record<string, string> = {
    postgresql: 'SELECT * FROM users LIMIT 10;',
    mysql:      'SELECT * FROM users LIMIT 10;',
    oracle:     'SELECT * FROM users WHERE ROWNUM <= 10;',
    sqlserver:  'SELECT TOP 10 * FROM users;',
    mongodb:    'db.users.find({}).limit(10)',
    redis:      'INFO server',
    couchbase:  'SELECT * FROM `bucket` LIMIT 10;',
  }

  const runConsoleQuery = async () => {
    if (!consoleDb || !consoleSql.trim() || consoleRunning) return
    setConsoleRunning(true)
    setConsoleResult(null)
    try {
      const res = await fetch(`/api/databases/${consoleDb.id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: consoleSql }),
      })
      const data = await res.json()
      setConsoleResult(data)
      setConsoleHistory(h => [consoleSql, ...h.filter(q => q !== consoleSql)].slice(0, 20))
    } finally {
      setConsoleRunning(false)
    }
  }

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setTestResult(null); setShowModal(true) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openEdit = (db: any) => {
    setEditId(db.id)
    setForm({ name: db.name, engine: db.engine, host: db.host, port: db.port, database: db.database, username: db.username, password: '', ssl: db.ssl, environment: db.environment, notes: db.notes ?? '' })
    setTestResult(null)
    setShowModal(true)
  }

  const setEngine = (e: DbEngine) => {
    const def = ENGINES.find(x => x.value === e)
    setForm(f => ({ ...f, engine: e, port: def?.defaultPort ?? f.port }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const method = editId ? 'PUT' : 'POST'
      const url = editId ? `/api/databases/${editId}` : '/api/databases'
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      mutate()
      setShowModal(false)
    } finally { setSaving(false) }
  }

  const handleTest = async () => {
    setTesting('modal')
    setTestResult(null)
    try {
      const res = await fetch('/api/databases/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { ok: boolean; message: string }
      setTestResult({ ok: data.ok, msg: data.message })
    } catch { setTestResult({ ok: false, msg: 'Network error' }) }
    finally { setTesting(null) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this database connection?')) return
    setDeleting(id)
    await fetch(`/api/databases/${id}`, { method: 'DELETE' })
    mutate()
    setDeleting(null)
  }

  const filtered = dbList.filter((d: { environment: string }) => envFilter === 'all' || d.environment === envFilter)

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-2 flex-wrap">
          {['all', 'production', 'staging', 'development', 'test'].map(env => (
            <button key={env} onClick={() => setEnvFilter(env)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                envFilter === env ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent')}>
              {env === 'all' ? 'All Environments' : env}
            </button>
          ))}
        </div>
        <button onClick={openAdd}
          className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-colors flex-shrink-0">
          <Plus size={15} /> Add Database
        </button>
      </div>

      {/* DB Cards */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((db: { id: string; name: string; engine: DbEngine; host: string; port: number; database: string; environment: DbEnv; status: string; healthScore: number; lastChecked: string; version?: string; notes?: string }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const perf = perfByDb[db.id] as any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cap  = capByDb[db.id]  as any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const repl = replByDb[db.id] as any
          const showCache = ['postgresql', 'mysql', 'sqlserver', 'oracle'].includes(db.engine)
          return (
          <div key={db.id} className="rounded-2xl bg-[#0f1629] border border-slate-800 hover:border-slate-700 transition-colors p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={cn('w-9 h-9 rounded-xl border flex items-center justify-center text-[10px] font-black flex-shrink-0', ENGINE_COLOR[db.engine])}>
                  {db.engine.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{db.name}</div>
                  <div className="text-[10px] text-slate-500">{ENGINES.find(e => e.value === db.engine)?.label}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setConsoleDb({ id: db.id, name: db.name, engine: db.engine }); setConsoleSql(''); setConsoleResult(null) }}
                  title="Open query console"
                  className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 transition-colors">
                  <Terminal size={12} />
                </button>
                <button onClick={() => openEdit(db)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300">
                  <Edit2 size={12} />
                </button>
                <button onClick={() => handleDelete(db.id)} disabled={deleting === db.id} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400">
                  {deleting === db.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            </div>

            <div className="space-y-1 mb-3">
              <div className="text-[11px] text-slate-400 font-mono">{db.host}:{db.port}/{db.database}</div>
              {db.version && <div className="text-[10px] text-slate-500">{db.version}</div>}
            </div>

            <div className="flex items-center gap-2 mb-3">
              <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', STATUS_BADGE[db.status])}>{db.status}</span>
              <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', ENV_BADGE[db.environment])}>{db.environment.slice(0,4)}</span>
              {repl && repl.role === 'replica' && (
                <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border',
                  repl.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : repl.status === 'warning' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20')}>
                  replica · {repl.lagSeconds}s lag
                </span>
              )}
              {repl && repl.role === 'primary' && repl.connectedReplicas > 0 && (
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  primary · {repl.connectedReplicas}r
                </span>
              )}
            </div>

            {/* Health bar */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-slate-500">Health</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full', db.healthScore >= 90 ? 'bg-emerald-500' : db.healthScore >= 70 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: `${db.healthScore}%` }} />
                  </div>
                  <span className="text-xs font-bold text-slate-400">{db.healthScore}</span>
                </div>
              </div>
            </div>

            {/* Live stats grid */}
            {perf && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 pt-2 border-t border-slate-800/60">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Connections</span>
                  <span className="text-[10px] font-bold text-slate-300">
                    {perf.activeConnections}
                    <span className="text-slate-600">/{perf.maxConnections}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Latency p50</span>
                  <span className={cn('text-[10px] font-bold',
                    perf.latencyP50Ms <= 10 ? 'text-emerald-400' : perf.latencyP50Ms <= 50 ? 'text-yellow-400' : 'text-red-400')}>
                    {fmtMs(perf.latencyP50Ms)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">TPS</span>
                  <span className="text-[10px] font-bold text-slate-300">{perf.tps.toLocaleString()}/s</span>
                </div>
                {showCache && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Cache hit</span>
                    <span className={cn('text-[10px] font-bold',
                      perf.cacheHitRatio >= 95 ? 'text-emerald-400' : perf.cacheHitRatio >= 85 ? 'text-yellow-400' : 'text-red-400')}>
                      {perf.cacheHitRatio.toFixed(1)}%
                    </span>
                  </div>
                )}
                {cap && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Size</span>
                      <span className="text-[10px] font-bold text-slate-300">{fmtSize(cap.totalSizeMB)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Full in</span>
                      <span className={cn('text-[10px] font-bold',
                        cap.daysUntilFull <= 30 ? 'text-red-400' : cap.daysUntilFull <= 60 ? 'text-yellow-400' : 'text-emerald-400')}>
                        {cap.daysUntilFull}d
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="text-[10px] text-slate-600 mt-2">Checked {timeAgo(db.lastChecked)}</div>
            {db.notes && <div className="text-[10px] text-yellow-400/80 mt-1 truncate">{db.notes}</div>}
          </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-2xl bg-[#0f1629] border border-slate-800 p-10 text-center">
            <Database className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No databases found</p>
            <button onClick={openAdd} className="mt-3 text-emerald-400 text-xs hover:text-emerald-300">Add your first database →</button>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">{editId ? 'Edit Database Connection' : 'Add Database Connection'}</h2>
              <button onClick={() => setShowModal(false)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Display Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="prod-postgres" className="settings-input" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Engine *</label>
                  <select value={form.engine} onChange={e => setEngine(e.target.value as DbEngine)} className="settings-input">
                    {ENGINES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Host *</label>
                  <input value={form.host} onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                    placeholder="localhost" className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Port</label>
                  <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: parseInt(e.target.value) || f.port }))}
                    className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Database / Schema</label>
                  <input value={form.database} onChange={e => setForm(f => ({ ...f, database: e.target.value }))}
                    placeholder="mydb" className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Username</label>
                  <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    placeholder="appuser" className="settings-input" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Password</label>
                  <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={editId ? '(leave blank to keep existing)' : '••••••••'} className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Environment</label>
                  <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value as DbEnv }))} className="settings-input">
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                    <option value="test">Test</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input type="checkbox" id="ssl" checked={form.ssl} onChange={e => setForm(f => ({ ...f, ssl: e.target.checked }))}
                    className="w-4 h-4 rounded" />
                  <label htmlFor="ssl" className="text-xs text-slate-400">SSL / TLS</label>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} className="settings-input resize-none" placeholder="Optional notes..." />
                </div>
              </div>

              {testResult && (
                <div className={cn('flex items-center gap-2 p-3 rounded-lg text-xs', testResult.ok ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border border-red-500/20 text-red-400')}>
                  {testResult.ok ? <CheckCircle size={13} /> : <XCircle size={13} />}
                  {testResult.msg}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={handleTest} disabled={!!testing}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white text-xs font-medium transition-colors disabled:opacity-50">
                  {testing === 'modal' ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />}
                  Test Connection
                </button>
                <button onClick={handleSave} disabled={saving || !form.name || !form.host}
                  className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : null}
                  {editId ? 'Save Changes' : 'Add Database'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Query Console Modal */}
      {consoleDb && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => { setConsoleDb(null); setConsoleResult(null) }}>
          <div className="bg-[#0a0f1e] border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal size={15} className="text-emerald-400" />
                <span className="text-sm font-bold text-white">{consoleDb.name}</span>
                <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase border', ENGINE_COLOR[consoleDb.engine])}>
                  {consoleDb.engine}
                </span>
              </div>
              <button onClick={() => { setConsoleDb(null); setConsoleResult(null) }}>
                <X size={15} className="text-slate-400 hover:text-white" />
              </button>
            </div>

            {/* Editor */}
            <div className="p-4 border-b border-slate-800">
              <div className="relative">
                <textarea
                  value={consoleSql}
                  onChange={e => setConsoleSql(e.target.value)}
                  onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runConsoleQuery() } }}
                  placeholder={PLACEHOLDERS[consoleDb.engine] ?? 'Enter query...'}
                  rows={5}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-4 py-3 text-xs font-mono text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-emerald-500/50"
                  spellCheck={false}
                />
                <div className="flex items-center justify-between mt-2">
                  <div className="flex gap-2 flex-wrap">
                    {consoleHistory.slice(0, 3).map((q, i) => (
                      <button key={i} onClick={() => setConsoleSql(q)}
                        className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded-lg truncate max-w-[180px] transition-colors">
                        <ChevronRight size={9} />{q.substring(0, 30)}{q.length > 30 ? '…' : ''}
                      </button>
                    ))}
                  </div>
                  <button onClick={runConsoleQuery} disabled={consoleRunning || !consoleSql.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-semibold text-xs transition-colors">
                    {consoleRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                    {consoleRunning ? 'Running…' : 'Run'} <span className="text-emerald-200 font-normal hidden sm:inline">Ctrl+Enter</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-auto p-4 min-h-0">
              {!consoleResult && !consoleRunning && (
                <div className="text-center text-slate-600 text-xs py-8">
                  {consoleDb.engine === 'mongodb'
                    ? 'Use db.collection.find({}) · db.collection.aggregate([]) · db.collection.countDocuments({})'
                    : consoleDb.engine === 'redis'
                    ? 'Enter Redis commands: GET key · KEYS * · HGETALL hash · INFO server'
                    : 'Enter SQL and press Ctrl+Enter or click Run'}
                </div>
              )}
              {consoleRunning && (
                <div className="flex items-center justify-center py-8 gap-2 text-slate-500 text-xs">
                  <Loader2 size={14} className="animate-spin" /> Executing…
                </div>
              )}
              {consoleResult?.error && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-xs text-red-400 font-mono whitespace-pre-wrap">
                  {consoleResult.error}
                </div>
              )}
              {consoleResult && !consoleResult.error && (
                <>
                  <div className="flex items-center gap-3 mb-3 text-[10px] text-slate-500">
                    <span className="text-emerald-400 font-bold">{consoleResult.rowCount} row{consoleResult.rowCount !== 1 ? 's' : ''}</span>
                    <span>{consoleResult.durationMs}ms</span>
                  </div>
                  {consoleResult.columns.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-800">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-800/60">
                            {consoleResult.columns.map(col => (
                              <th key={col} className="px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wide whitespace-nowrap border-b border-slate-700">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {consoleResult.rows.map((row, ri) => (
                            <tr key={ri} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                              {row.map((cell, ci) => (
                                <td key={ci} className="px-3 py-2 text-slate-300 font-mono whitespace-nowrap max-w-[300px] truncate">
                                  {cell === null ? <span className="text-slate-600">NULL</span> : String(cell)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 text-center py-4">Query executed — no rows returned</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
