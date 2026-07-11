'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Play, Plus, Trash2, ToggleLeft, ToggleRight, Clock, Zap, AlertTriangle,
  CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, History, X,
  Database, Terminal,
} from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type AutomationTrigger = 'cron' | 'threshold' | 'manual'
type AutomationActionType = 'vacuum' | 'analyze' | 'reindex' | 'kill_idle' | 'custom_sql' | 'slack_notify' | 'email_notify'
type RunStatus = 'success' | 'failed' | 'running' | 'skipped'

interface AutomationAction { type: AutomationActionType; sql?: string; message?: string }
interface AutomationRule {
  id: string; name: string; description: string; dbId: string; dbName: string
  trigger: AutomationTrigger; cronExpr?: string; cronLabel?: string
  thresholdMetric?: string; thresholdOperator?: string; thresholdValue?: number
  actions: AutomationAction[]; enabled: boolean
  lastRunAt?: string; lastRunStatus?: RunStatus; lastRunOutput?: string; nextRunAt?: string
  runCount: number; createdAt: string; tags: string[]
}
interface AutomationRun {
  id: string; ruleId: string; startedAt: string; completedAt: string
  status: RunStatus; output: string; triggeredBy: string
}

const ACTION_LABELS: Record<AutomationActionType, string> = {
  vacuum: 'VACUUM ANALYZE', analyze: 'ANALYZE (stats)', reindex: 'REINDEX',
  kill_idle: 'Kill Idle Connections', custom_sql: 'Custom SQL',
  slack_notify: 'Slack Notify', email_notify: 'Email Notify',
}

const ACTION_COLORS: Record<AutomationActionType, string> = {
  vacuum: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  analyze: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  reindex: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  kill_idle: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  custom_sql: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  slack_notify: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  email_notify: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
}

const CRON_PRESETS = [
  { label: 'Every 15 min', expr: '*/15 * * * *' },
  { label: 'Hourly',       expr: '0 * * * *' },
  { label: 'Daily 2am',    expr: '0 2 * * *' },
  { label: 'Daily 4am',    expr: '0 4 * * *' },
  { label: 'Weekly Sun',   expr: '0 3 * * 0' },
  { label: 'Monthly 1st',  expr: '0 4 1 * *' },
]

const THRESHOLD_METRICS = [
  { value: 'slow_query_count', label: 'Slow query count (5-min window)' },
  { value: 'cpu_pct',          label: 'CPU %' },
  { value: 'mem_pct',          label: 'Memory %' },
  { value: 'conn_pct',         label: 'Connection pool %' },
  { value: 'replication_lag',  label: 'Replication lag (seconds)' },
  { value: 'disk_pct',         label: 'Disk usage %' },
]

const EMPTY_RULE = {
  name: '', description: '', dbId: '*', trigger: 'cron' as AutomationTrigger,
  cronExpr: '0 2 * * *', cronLabel: 'Daily at 02:00 UTC',
  thresholdMetric: 'slow_query_count', thresholdOperator: '>', thresholdValue: 10,
  actions: [{ type: 'vacuum' as AutomationActionType, sql: '', message: '' }] as AutomationAction[],
  enabled: true, tags: [],
}

function StatusBadge({ status }: { status?: RunStatus }) {
  if (!status) return <span className="text-xs text-slate-500">Never run</span>
  const cfg = {
    success: { cls: 'text-emerald-400', icon: CheckCircle, label: 'Success' },
    failed:  { cls: 'text-red-400',     icon: XCircle,     label: 'Failed' },
    running: { cls: 'text-blue-400',    icon: Loader2,     label: 'Running' },
    skipped: { cls: 'text-slate-400',   icon: Clock,       label: 'Skipped' },
  }[status]
  const Icon = cfg.icon
  return (
    <span className={cn('flex items-center gap-1 text-xs font-medium', cfg.cls)}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {cfg.label}
    </span>
  )
}

function RunHistoryPanel({ runs, ruleId }: { runs: AutomationRun[]; ruleId: string }) {
  const filtered = runs.filter(r => r.ruleId === ruleId).slice(0, 8)
  const [expanded, setExpanded] = useState<AutomationRun | null>(null)
  if (!filtered.length) return <div className="text-xs text-slate-500 p-3">No runs yet</div>
  return (
    <div className="space-y-1 p-2">
      {filtered.map(run => (
        <div key={run.id} onClick={() => setExpanded(run)}
          className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/40 border border-slate-800/40 cursor-pointer hover:border-slate-700 transition-colors">
          <StatusBadge status={run.status} />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-slate-500">{timeAgo(run.startedAt)} · via {run.triggeredBy}</div>
            <pre className="text-[10px] text-slate-400 font-mono whitespace-pre-wrap mt-0.5 line-clamp-2">{run.output}</pre>
          </div>
          <ChevronRight size={10} className="text-slate-600 flex-shrink-0 mt-1" />
        </div>
      ))}

      {/* Full output modal */}
      {expanded && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setExpanded(null)}>
          <div className="bg-[#0f1629] border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <StatusBadge status={expanded.status} />
                <span className="text-xs text-slate-400">{new Date(expanded.startedAt).toLocaleString()} · via {expanded.triggeredBy}</span>
              </div>
              <button onClick={() => setExpanded(null)}><X size={14} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{expanded.output || '(no output)'}</pre>
            </div>
            {expanded.completedAt && (
              <div className="px-5 py-3 border-t border-slate-800 text-[10px] text-slate-600">
                Duration: {Math.round((new Date(expanded.completedAt).getTime() - new Date(expanded.startedAt).getTime()) / 1000)}s
                {' · '}Run ID: {expanded.id}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AutomationPage() {
  const { data: rules = [], mutate: mutateRules } = useSWR<AutomationRule[]>('/api/automation', fetcher)
  const { data: runs = [] } = useSWR<AutomationRun[]>('/api/automation/runs', fetcher, { refreshInterval: 10000 })
  const { data: dbs = [] } = useSWR<{ id: string; name: string }[]>('/api/databases', fetcher)

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_RULE })
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [confirmRun, setConfirmRun] = useState<AutomationRule | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [runOutput, setRunOutput] = useState<{ id: string; output: string } | null>(null)

  const stats = {
    total: rules.length,
    enabled: rules.filter(r => r.enabled).length,
    runsToday: runs.filter(r => new Date(r.startedAt).toDateString() === new Date().toDateString()).length,
    failed: runs.filter(r => r.status === 'failed' && new Date(r.startedAt) > new Date(Date.now() - 86400000)).length,
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch('/api/automation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          dbName: dbs.find(d => d.id === form.dbId)?.name ?? (form.dbId === '*' ? 'All databases' : form.dbId),
        }),
      })
      mutateRules()
      setShowModal(false)
      setForm({ ...EMPTY_RULE })
    } finally { setSaving(false) }
  }

  const handleToggle = async (rule: AutomationRule) => {
    setTogglingId(rule.id)
    try {
      await fetch(`/api/automation/${rule.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      mutateRules()
    } finally { setTogglingId(null) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this automation rule?')) return
    setDeletingId(id)
    try {
      await fetch(`/api/automation/${id}`, { method: 'DELETE' })
      mutateRules()
    } finally { setDeletingId(null) }
  }

  const handleRunNow = async (id: string) => {
    setConfirmRun(null)
    setRunningId(id)
    try {
      const res = await fetch(`/api/automation/${id}/run`, { method: 'POST' })
      const data = await res.json()
      setRunOutput({ id, output: data.output ?? 'Completed' })
      mutateRules()
    } finally { setRunningId(null) }
  }

  const setAction = (type: AutomationActionType) => {
    setForm(f => ({ ...f, actions: [{ type }] }))
  }

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Rules', value: stats.total, color: 'text-white' },
          { label: 'Enabled', value: stats.enabled, color: 'text-emerald-400' },
          { label: 'Runs Today', value: stats.runsToday, color: 'text-blue-400' },
          { label: 'Failed (24h)', value: stats.failed, color: stats.failed > 0 ? 'text-red-400' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
            <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Automation Rules</h2>
          <p className="text-sm text-slate-400 mt-0.5">Scheduled and threshold-triggered database maintenance tasks</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_RULE }); setShowModal(true) }}
          className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus size={14} />
          New Rule
        </button>
      </div>

      {/* Rules List */}
      <div className="space-y-2">
        {rules.map(rule => {
          const isExpanded = expandedId === rule.id
          const isRunning = runningId === rule.id
          const primaryAction = rule.actions[0]

          return (
            <div key={rule.id}
              className={cn('bg-slate-900/60 border rounded-xl overflow-hidden transition-all',
                rule.enabled ? 'border-slate-800/60' : 'border-slate-800/30 opacity-60')}>

              {/* Rule Header Row */}
              <div className="flex items-center gap-3 p-4">
                {/* Toggle */}
                <button onClick={() => handleToggle(rule)} disabled={togglingId === rule.id}
                  className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors">
                  {togglingId === rule.id
                    ? <Loader2 size={20} className="animate-spin text-slate-500" />
                    : rule.enabled
                      ? <ToggleRight size={20} className="text-emerald-400" />
                      : <ToggleLeft size={20} />
                  }
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{rule.name}</span>
                    {primaryAction && (
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', ACTION_COLORS[primaryAction.type])}>
                        {ACTION_LABELS[primaryAction.type]}
                      </span>
                    )}
                    {rule.trigger === 'cron' && (
                      <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Clock size={10} />{rule.cronLabel}
                      </span>
                    )}
                    {rule.trigger === 'threshold' && (
                      <span className="flex items-center gap-1 text-[10px] text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-1.5 py-0.5 rounded">
                        <Zap size={10} />Threshold: {rule.thresholdMetric} {rule.thresholdOperator} {rule.thresholdValue}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <Database size={10} />{rule.dbName}
                    </span>
                    <StatusBadge status={rule.lastRunStatus} />
                    {rule.lastRunAt && <span className="text-[10px] text-slate-600">Last: {timeAgo(rule.lastRunAt)}</span>}
                    {rule.nextRunAt && rule.trigger === 'cron' && (
                      <span className="text-[10px] text-slate-600">Next: {timeAgo(rule.nextRunAt)}</span>
                    )}
                    <span className="text-[10px] text-slate-600">{rule.runCount} runs</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setConfirmRun(rule)} disabled={isRunning || !rule.enabled}
                    title="Run now"
                    className="p-1.5 rounded-lg hover:bg-emerald-500/10 text-slate-500 hover:text-emerald-400 disabled:opacity-40 transition-colors">
                    {isRunning ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  </button>
                  <button onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                    title="History"
                    className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
                    <History size={13} />
                  </button>
                  <button onClick={() => handleDelete(rule.id)} disabled={deletingId === rule.id}
                    title="Delete"
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors">
                    {deletingId === rule.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                  <button onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                    className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                </div>
              </div>

              {/* Run Output (inline) */}
              {runOutput?.id === rule.id && (
                <div className="mx-4 mb-3 p-3 bg-slate-950/60 border border-emerald-500/20 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Last Run Output</span>
                    <button onClick={() => setRunOutput(null)} className="text-slate-600 hover:text-slate-400">
                      <X size={11} />
                    </button>
                  </div>
                  <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{runOutput.output}</pre>
                </div>
              )}

              {/* Expanded Run History */}
              {isExpanded && (
                <div className="border-t border-slate-800/40">
                  <div className="flex items-center gap-2 px-4 py-2 bg-slate-950/30">
                    <History size={11} className="text-slate-500" />
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Run History</span>
                  </div>
                  <RunHistoryPanel runs={runs} ruleId={rule.id} />
                </div>
              )}
            </div>
          )
        })}

        {rules.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <Terminal className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No automation rules yet. Create one to get started.</p>
          </div>
        )}
      </div>

      {/* Run Confirmation Modal */}
      {confirmRun && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmRun(null)}>
          <div className="bg-[#0f1629] border border-slate-700 rounded-2xl w-full max-w-md"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Play size={14} className="text-emerald-400" />
                <span className="text-sm font-bold text-white">Confirm Run</span>
              </div>
              <button onClick={() => setConfirmRun(null)}><X size={14} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex justify-between"><span className="text-slate-500">Rule</span><span className="text-white font-semibold">{confirmRun.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Target DB</span><span className="text-white">{confirmRun.dbName}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Trigger</span><span className="text-slate-300">manual</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Actions</span><span className="text-slate-300">{confirmRun.actions.map(a => a.type).join(', ')}</span></div>
              </div>
              {confirmRun.actions.filter(a => a.sql).map((a, i) => (
                <div key={i}>
                  <div className="text-slate-500 mb-1 uppercase text-[10px]">SQL to execute</div>
                  <pre className="bg-slate-900 border border-slate-700 rounded-xl p-3 text-emerald-300 font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">{a.sql}</pre>
                </div>
              ))}
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <span className="text-yellow-300/80">This will execute immediately on the target database.</span>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setConfirmRun(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors">
                  Cancel
                </button>
                <button onClick={() => handleRunNow(confirmRun.id)} disabled={runningId === confirmRun.id}
                  className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold transition-colors flex items-center justify-center gap-2">
                  {runningId === confirmRun.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Run Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Rule Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative bg-[#0d1117] border border-slate-700/60 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-800/60">
              <h3 className="text-base font-bold text-white">New Automation Rule</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Rule Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Daily VACUUM on prod-postgres"
                  className="settings-input w-full" />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What does this rule do?"
                  className="settings-input w-full" />
              </div>

              {/* Database */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Target Database</label>
                <select value={form.dbId} onChange={e => setForm(f => ({ ...f, dbId: e.target.value }))}
                  className="settings-input w-full">
                  <option value="*">All databases</option>
                  {dbs.map((d: { id: string; name: string }) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              {/* Trigger Type */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Trigger</label>
                <div className="flex gap-2">
                  {(['cron', 'threshold', 'manual'] as AutomationTrigger[]).map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, trigger: t }))}
                      className={cn('flex-1 py-2 rounded-lg text-xs font-medium capitalize border transition-colors',
                        form.trigger === t
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-white')}>
                      {t === 'cron' ? 'Schedule' : t === 'threshold' ? 'Threshold' : 'Manual'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cron Config */}
              {form.trigger === 'cron' && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Schedule</label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {CRON_PRESETS.map(p => (
                      <button key={p.expr} onClick={() => setForm(f => ({ ...f, cronExpr: p.expr, cronLabel: p.label }))}
                        className={cn('px-2 py-1 rounded text-[10px] font-medium border transition-colors',
                          form.cronExpr === p.expr
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-white')}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input value={form.cronExpr} onChange={e => setForm(f => ({ ...f, cronExpr: e.target.value, cronLabel: 'Custom' }))}
                    placeholder="Cron expression e.g. 0 2 * * *"
                    className="settings-input w-full font-mono text-xs" />
                </div>
              )}

              {/* Threshold Config */}
              {form.trigger === 'threshold' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">Metric</label>
                    <select value={form.thresholdMetric}
                      onChange={e => setForm(f => ({ ...f, thresholdMetric: e.target.value }))}
                      className="settings-input w-full">
                      {THRESHOLD_METRICS.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">Operator</label>
                      <select value={form.thresholdOperator}
                        onChange={e => setForm(f => ({ ...f, thresholdOperator: e.target.value as '>' | '<' | '>=' | '<=' }))}
                        className="settings-input w-full">
                        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">Value</label>
                      <input type="number" value={form.thresholdValue}
                        onChange={e => setForm(f => ({ ...f, thresholdValue: Number(e.target.value) }))}
                        className="settings-input w-full" />
                    </div>
                  </div>
                </div>
              )}

              {/* Action */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Action</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(ACTION_LABELS) as AutomationActionType[]).map(a => (
                    <button key={a} onClick={() => setAction(a)}
                      className={cn('py-2 px-3 rounded-lg text-xs font-medium border text-left transition-colors',
                        form.actions[0]?.type === a
                          ? cn('border', ACTION_COLORS[a])
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-white')}>
                      {ACTION_LABELS[a]}
                    </button>
                  ))}
                </div>

                {/* SQL field for custom_sql */}
                {form.actions[0]?.type === 'custom_sql' && (
                  <textarea value={form.actions[0].sql ?? ''}
                    onChange={e => setForm(f => ({ ...f, actions: [{ type: 'custom_sql', sql: e.target.value }] }))}
                    placeholder="Enter SQL to execute..."
                    rows={4}
                    className="settings-input w-full font-mono text-xs mt-2 resize-none" />
                )}

                {/* Message field for notify actions */}
                {(form.actions[0]?.type === 'slack_notify' || form.actions[0]?.type === 'email_notify') && (
                  <input value={form.actions[0].message ?? ''}
                    onChange={e => setForm(f => ({ ...f, actions: [{ type: form.actions[0].type, message: e.target.value }] }))}
                    placeholder="Notification message..."
                    className="settings-input w-full mt-2" />
                )}
              </div>
            </div>

            <div className="flex gap-2 p-5 border-t border-slate-800/60">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.name}
                className="flex-1 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {saving ? 'Saving…' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
