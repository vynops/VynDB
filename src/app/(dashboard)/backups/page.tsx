'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  CheckCircle, XCircle, RefreshCw, Clock, AlertTriangle, HardDrive,
  Shield, Play, Trash2, Loader2, X, Plus, Edit2, ToggleLeft, ToggleRight, CalendarClock, ChevronRight,
} from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type BackupStatus = 'succeeded' | 'failed' | 'running' | 'scheduled' | 'skipped'
type BackupType   = 'full' | 'schema-only' | 'data-only'

interface BackupSchedule {
  id: string; dbId: string; dbName: string; engine: string
  cronExpr: string; cronLabel: string; backupType: BackupType
  location: string; retentionDays: number; enabled: boolean
  lastRunAt?: string; lastRunStatus?: string; nextRunAt?: string; createdAt: string
}

const CRON_PRESETS = [
  { label: 'Every 30 min',     expr: '*/30 * * * *' },
  { label: 'Every hour',       expr: '0 * * * *'    },
  { label: 'Every 6 hours',    expr: '0 */6 * * *'  },
  { label: 'Every 12 hours',   expr: '0 */12 * * *' },
  { label: 'Daily 01:00 UTC',  expr: '0 1 * * *'    },
  { label: 'Daily 02:00 UTC',  expr: '0 2 * * *'    },
  { label: 'Daily 03:00 UTC',  expr: '0 3 * * *'    },
  { label: 'Daily 04:00 UTC',  expr: '0 4 * * *'    },
  { label: 'Weekly Sun 02:00', expr: '0 2 * * 0'    },
  { label: 'Weekly Mon 02:00', expr: '0 2 * * 1'    },
  { label: 'Monthly 1st 02:00',expr: '0 2 1 * *'    },
]

const ENGINE_COLORS: Record<string, string> = {
  postgresql: 'text-indigo-400', mysql: 'text-yellow-400',
  mongodb: 'text-green-400', redis: 'text-orange-400',
}

const EMPTY_SCHED = {
  dbId: '', dbName: '', engine: '',
  cronExpr: '0 2 * * *', cronLabel: 'Daily 02:00 UTC',
  backupType: 'full' as BackupType,
  location: '', retentionDays: 0, enabled: true,
}


interface BackupJob {
  id: string; dbId: string; dbName: string; type: string; status: BackupStatus
  sizeMB: number; rpoHrs: number; rtoMins: number; location: string; error?: string
  scheduledAt: string; startedAt?: string; completedAt?: string
}
interface DiskStats { fileCount: number; totalMB: number; oldestDate: string | null; path: string }
interface RunResult { ok: boolean; succeeded: number; failed: number; total: number }

const STATUS_CFG: Record<BackupStatus, { icon: typeof CheckCircle; color: string }> = {
  succeeded: { icon: CheckCircle,    color: 'text-emerald-400' },
  failed:    { icon: XCircle,        color: 'text-red-400'     },
  running:   { icon: RefreshCw,      color: 'text-blue-400'    },
  scheduled: { icon: Clock,          color: 'text-slate-400'   },
  skipped:   { icon: AlertTriangle,  color: 'text-yellow-400'  },
}

const TYPE_COLOR: Record<string, string> = {
  full:        'bg-emerald-500/10 text-emerald-400',
  incremental: 'bg-blue-500/10 text-blue-400',
  wal:         'bg-violet-500/10 text-violet-400',
  logical:     'bg-orange-500/10 text-orange-400',
}

const BACKUP_TYPES: { value: BackupType; label: string; desc: string; engines: string }[] = [
  { value: 'full',        label: 'Full',        desc: 'Complete backup of all data + schema', engines: 'All engines' },
  { value: 'schema-only', label: 'Schema Only',  desc: 'DDL only — tables, indexes, views (no data)', engines: 'PostgreSQL, MySQL' },
  { value: 'data-only',   label: 'Data Only',    desc: 'Row data only, no DDL statements', engines: 'PostgreSQL, MySQL' },
]

export default function BackupsPage() {
  const [pageTab, setPageTab] = useState<'jobs' | 'schedules'>('jobs')

  const { data: backups = [], mutate } = useSWR<BackupJob[]>('/api/backups', fetcher, { refreshInterval: 30000 })
  const { data: dbs = [] }             = useSWR<{ id: string; name: string; engine: string }[]>('/api/databases', fetcher)
  const { data: diskStats, mutate: mutateDisk } = useSWR<DiskStats>('/api/backups?stats=1', fetcher)
  const { data: schedules = [], mutate: mutateSchedules } = useSWR<BackupSchedule[]>('/api/backup-schedules', fetcher)

  const [showRunModal, setShowRunModal] = useState(false)
  const [selectedDb,   setSelectedDb]  = useState<string>('all')
  const [selectedType, setSelectedType]= useState<BackupType>('full')
  const [customPath,   setCustomPath]   = useState<string>('')
  const [running,      setRunning]     = useState(false)
  const [runResult,    setRunResult]   = useState<RunResult | null>(null)
  const [deletingId,   setDeletingId]  = useState<string | null>(null)
  const [cleaningUp,   setCleaningUp]  = useState(false)
  const [cleanupMsg,   setCleanupMsg]  = useState<string | null>(null)
  const [retentionDays,setRetention]   = useState(7)
  const [statusFilter, setStatusFilter]= useState<string>('all')
  const [selectedBackup, setSelectedBackup] = useState<BackupJob | null>(null)

  // Schedule state
  const [showSchedModal, setShowSchedModal] = useState(false)
  const [editSchedId,    setEditSchedId]    = useState<string | null>(null)
  const [schedForm,      setSchedForm]      = useState({ ...EMPTY_SCHED })
  const [savingSched,    setSavingSched]    = useState(false)
  const [deletingSchedId, setDeletingSchedId] = useState<string | null>(null)
  const [togglingSchedId, setTogglingSchedId] = useState<string | null>(null)

  const list     = Array.isArray(backups) ? backups : []
  const filtered = statusFilter === 'all' ? list : list.filter(b => b.status === statusFilter)
  const stats    = {
    succeeded: list.filter(b => b.status === 'succeeded').length,
    failed:    list.filter(b => b.status === 'failed').length,
    running:   list.filter(b => b.status === 'running').length,
    totalMB:   list.reduce((s, b) => s + (b.sizeMB || 0), 0),
  }

  const handleRunBackup = async () => {
    setRunning(true); setRunResult(null)
    try {
      const body = selectedDb === 'all'
        ? { type: selectedType, path: customPath || undefined }
        : { dbId: selectedDb, type: selectedType, path: customPath || undefined }
      const res  = await fetch('/api/backups/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      setRunResult(selectedDb === 'all' ? data : { ok: data.ok, succeeded: data.ok ? 1 : 0, failed: data.ok ? 0 : 1, total: 1 })
      mutate(); mutateDisk()
    } finally { setRunning(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this backup record and file from disk?')) return
    setDeletingId(id)
    try { await fetch(`/api/backups/${id}`, { method: 'DELETE' }); mutate(); mutateDisk() }
    finally { setDeletingId(null) }
  }

  const handleCleanup = async () => {
    setCleaningUp(true); setCleanupMsg(null)
    try {
      const res  = await fetch('/api/backups/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retentionDays }) })
      const data = await res.json()
      setCleanupMsg(`Removed ${data.filesDeleted} files + ${data.recordsRemoved} records older than ${retentionDays} days`)
      mutate(); mutateDisk()
    } finally { setCleaningUp(false) }
  }

  const openAddSchedule = () => {
    setEditSchedId(null)
    setSchedForm({ ...EMPTY_SCHED, dbId: dbs[0]?.id ?? '', dbName: dbs[0]?.name ?? '', engine: dbs[0]?.engine ?? '' })
    setShowSchedModal(true)
  }

  const openEditSchedule = (s: BackupSchedule) => {
    setEditSchedId(s.id)
    setSchedForm({ dbId: s.dbId, dbName: s.dbName, engine: s.engine, cronExpr: s.cronExpr, cronLabel: s.cronLabel, backupType: s.backupType, location: s.location, retentionDays: s.retentionDays, enabled: s.enabled })
    setShowSchedModal(true)
  }

  const handleSaveSchedule = async () => {
    setSavingSched(true)
    const db = dbs.find(d => d.id === schedForm.dbId)
    const body = { ...schedForm, dbName: db?.name ?? schedForm.dbName, engine: db?.engine ?? schedForm.engine }
    try {
      if (editSchedId) {
        await fetch(`/api/backup-schedules/${editSchedId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } else {
        await fetch('/api/backup-schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      }
      mutateSchedules(); setShowSchedModal(false)
    } finally { setSavingSched(false) }
  }

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Delete this backup schedule?')) return
    setDeletingSchedId(id)
    try { await fetch(`/api/backup-schedules/${id}`, { method: 'DELETE' }); mutateSchedules() }
    finally { setDeletingSchedId(null) }
  }

  const handleToggleSchedule = async (s: BackupSchedule) => {
    setTogglingSchedId(s.id)
    try {
      await fetch(`/api/backup-schedules/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, enabled: !s.enabled }) })
      mutateSchedules()
    } finally { setTogglingSchedId(null) }
  }

  const setCronPreset = (expr: string, label: string) => {
    setSchedForm(f => ({ ...f, cronExpr: expr, cronLabel: label }))
  }

  return (
    <div className="space-y-5">

      {/* Tab switcher */}
      <div className="flex items-center justify-between">
        <div className="flex bg-slate-900/60 border border-slate-800/40 rounded-lg p-0.5 gap-0.5">
          {(['jobs', 'schedules'] as const).map(t => (
            <button key={t} onClick={() => setPageTab(t)}
              className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors',
                pageTab === t ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300')}>
              {t === 'schedules' && <CalendarClock size={13} />}
              {t === 'jobs' ? 'Backup Jobs' : 'Schedules'}
              {t === 'schedules' && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-bold ml-0.5">
                  {Array.isArray(schedules) ? schedules.filter(s => s.enabled).length : 0}
                </span>
              )}
            </button>
          ))}
        </div>
        {pageTab === 'schedules' && (
          <button onClick={openAddSchedule}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors">
            <Plus size={13} /> New Schedule
          </button>
        )}
      </div>

      {/* ── Schedules Tab ──────────────────────────────────────────────────── */}
      {pageTab === 'schedules' && (
        <div className="space-y-3">
          {Array.isArray(schedules) && schedules.map(s => (
            <div key={s.id} className={cn('bg-slate-900/60 border rounded-xl p-4 transition-all', s.enabled ? 'border-slate-800/60' : 'border-slate-800/30 opacity-60')}>
              <div className="flex items-start gap-3">
                {/* Toggle */}
                <button onClick={() => handleToggleSchedule(s)} disabled={togglingSchedId === s.id} className="flex-shrink-0 mt-0.5">
                  {togglingSchedId === s.id
                    ? <Loader2 size={20} className="animate-spin text-slate-500" />
                    : s.enabled
                      ? <ToggleRight size={20} className="text-emerald-400" />
                      : <ToggleLeft size={20} className="text-slate-600" />
                  }
                </button>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-xs font-bold', ENGINE_COLORS[s.engine] ?? 'text-slate-300')}>{s.dbName}</span>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">{s.cronLabel}</span>
                    <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-medium capitalize">{s.backupType}</span>
                    {s.retentionDays > 0 && <span className="text-[10px] text-slate-500">Keep {s.retentionDays}d</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
                    <span className="font-mono text-slate-500">{s.cronExpr}</span>
                    {s.location ? <span className="text-slate-500 truncate max-w-[200px]" title={s.location}>📁 {s.location}</span> : <span className="text-slate-600">default location</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap text-[11px]">
                    {s.lastRunAt && (
                      <span className={cn('flex items-center gap-1', s.lastRunStatus === 'succeeded' ? 'text-emerald-400' : 'text-red-400')}>
                        {s.lastRunStatus === 'succeeded' ? <CheckCircle size={10} /> : <XCircle size={10} />}
                        Last: {timeAgo(s.lastRunAt)}
                      </span>
                    )}
                    {s.nextRunAt && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Clock size={10} /> Next: {timeAgo(s.nextRunAt)}
                      </span>
                    )}
                    {!s.lastRunAt && <span className="text-slate-600">Never run</span>}
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEditSchedule(s)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => handleDeleteSchedule(s.id)} disabled={deletingSchedId === s.id}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40">
                    {deletingSchedId === s.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(!Array.isArray(schedules) || schedules.length === 0) && (
            <div className="text-center py-16 text-slate-500">
              <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No backup schedules yet.</p>
              <p className="text-xs mt-1 text-slate-600">Click "New Schedule" to configure per-database backup scheduling.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Jobs Tab ──────────────────────────────────────────────────────── */}
      {pageTab === 'jobs' && (<>
      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Succeeded',  value: stats.succeeded, color: 'text-emerald-400' },
          { label: 'Failed',     value: stats.failed,    color: stats.failed > 0 ? 'text-red-400' : 'text-slate-500' },
          { label: 'Running',    value: stats.running,   color: 'text-blue-400' },
          { label: 'Total Jobs', value: list.length,     color: 'text-white' },
          { label: 'Record Size', value: stats.totalMB >= 1024 ? `${(stats.totalMB/1024).toFixed(1)} GB` : `${stats.totalMB} MB`, color: 'text-slate-300' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
            <div className={cn('text-xl font-bold', s.color)}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Storage + Controls */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5">
              <HardDrive size={13} className="text-slate-500" />
              <span className="font-bold text-white">{diskStats?.totalMB ?? 0} MB</span> on disk
              <span className="text-slate-600">({diskStats?.fileCount ?? 0} files)</span>
            </span>
            {diskStats?.oldestDate && <span>Oldest: {timeAgo(diskStats.oldestDate)}</span>}
            <code className="text-[10px] text-slate-600">{diskStats?.path ?? '…/backups'}</code>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Cleanup */}
            <div className="flex items-center gap-1.5 bg-slate-800/40 border border-slate-700/40 rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] text-slate-500">Keep last</span>
              <select value={retentionDays} onChange={e => setRetention(Number(e.target.value))}
                className="bg-slate-800 text-white text-xs border border-slate-700 rounded px-1.5 py-0.5 outline-none cursor-pointer">
                {[3,7,14,30,60].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
              <button onClick={handleCleanup} disabled={cleaningUp}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors">
                {cleaningUp ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                Cleanup
              </button>
            </div>
            {/* Run Backup */}
            <button onClick={() => { setShowRunModal(true); setRunResult(null) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors">
              <Play size={11} /> Run Backup
            </button>
          </div>
        </div>
        {cleanupMsg && <div className="text-xs text-emerald-400">{cleanupMsg}</div>}
      </div>

      {/* Backup Jobs Table */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800/60">
          <div>
            <h2 className="text-sm font-bold text-white">Backup Jobs</h2>
            <p className="text-xs text-slate-500">{list.length} records</p>
          </div>
          <div className="flex gap-1">
            {['all','succeeded','failed','scheduled'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn('px-2 py-1 rounded text-[10px] font-medium capitalize transition-colors',
                  statusFilter === s ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300')}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/40">
                <th className="text-left px-5 py-3 text-slate-400 font-semibold">Database</th>
                <th className="text-left px-3 py-3 text-slate-400 font-semibold">Type</th>
                <th className="text-left px-3 py-3 text-slate-400 font-semibold">Status</th>
                <th className="text-left px-3 py-3 text-slate-400 font-semibold hidden sm:table-cell">Size</th>
                <th className="text-left px-3 py-3 text-slate-400 font-semibold hidden md:table-cell">RPO / RTO</th>
                <th className="text-left px-3 py-3 text-slate-400 font-semibold">When</th>
                <th className="text-right px-4 py-3 text-slate-400 font-semibold">Del</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40">
              {filtered.map(b => {
                const cfg = STATUS_CFG[b.status] ?? STATUS_CFG.scheduled
                const Icon = cfg.icon
                return (
                  <tr key={b.id} onClick={() => setSelectedBackup(b)}
                    className={cn('hover:bg-slate-800/20 transition-colors cursor-pointer', b.status === 'failed' && 'bg-red-500/3')}>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-white">{b.dbName}</div>
                      <div className="text-[10px] text-slate-600 font-mono truncate max-w-[200px]">
                        {b.location?.replace('file://', '') || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', TYPE_COLOR[b.type] ?? 'bg-slate-700 text-slate-400')}>
                        {b.type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', cfg.color, b.status === 'running' && 'animate-spin')} />
                        <span className={cn('font-semibold', cfg.color)}>{b.status}</span>
                      </div>
                      {b.error && <div className="text-[10px] text-red-300/70 mt-0.5 max-w-[180px] truncate" title={b.error}>{b.error}</div>}
                    </td>
                    <td className="px-3 py-3 text-slate-300 hidden sm:table-cell">
                      {b.sizeMB > 0 ? (b.sizeMB >= 1024 ? `${(b.sizeMB/1024).toFixed(1)} GB` : `${b.sizeMB} MB`) : '—'}
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <span className={cn('font-medium text-[10px]', b.rpoHrs > 24 ? 'text-red-400' : b.rpoHrs > 8 ? 'text-yellow-400' : 'text-emerald-400')}>
                        {b.rpoHrs}h RPO
                      </span>
                      <span className="text-slate-500 ml-1 text-[10px]">/ {b.rtoMins}m RTO</span>
                    </td>
                    <td className="px-3 py-3 text-slate-400">
                      {b.completedAt ? timeAgo(b.completedAt) : b.startedAt ? `Started ${timeAgo(b.startedAt)}` : `Sched. ${timeAgo(b.scheduledAt)}`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={e => { e.stopPropagation(); handleDelete(b.id) }} disabled={deletingId === b.id}
                        title="Delete backup file + record"
                        className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors disabled:opacity-40">
                        {deletingId === b.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-10 text-center text-slate-500">
            <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No backup records {statusFilter !== 'all' ? `with status "${statusFilter}"` : ''}
          </div>
        )}
      </div>

      {/* Recovery Guidance */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" /> Recovery Commands
        </h3>
        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          {[
            { title: 'PostgreSQL',  desc: 'pg_restore -U labdb -d labdb /path/backup.dump' },
            { title: 'MySQL',       desc: 'gunzip < backup.sql.gz | mysql -u labdb -p labdb' },
            { title: 'MongoDB',     desc: 'mongorestore --host 127.0.0.1 --db labdb --archive < backup.archive.gz --gzip' },
            { title: 'Redis',       desc: 'Stop Redis → copy dump.rdb to data dir → start Redis' },
          ].map(tip => (
            <div key={tip.title} className="p-3 rounded-xl bg-slate-900 border border-slate-700">
              <div className="text-emerald-400 font-semibold mb-1">{tip.title}</div>
              <code className="text-slate-400 text-[11px] leading-relaxed">{tip.desc}</code>
            </div>
          ))}
        </div>
      </div>
      </>)}  {/* end jobs tab */}

      {/* ── Run Backup Modal (available on both tabs) ─────────────────────── */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowRunModal(false)} />
          <div className="relative bg-[#0d1117] border border-slate-700/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-800/60">
              <h3 className="text-base font-bold text-white">Run Backup</h3>
              <button onClick={() => setShowRunModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* DB selector */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Target Database</label>
                <select value={selectedDb} onChange={e => setSelectedDb(e.target.value)} className="settings-input w-full">
                  <option value="all">All lab databases</option>
                  {dbs.filter(d => ['postgresql','mysql','mongodb','redis'].includes(d.engine)).map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.engine})</option>
                  ))}
                </select>
              </div>

              {/* Type selector */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Backup Type</label>
                <div className="space-y-2">
                  {BACKUP_TYPES.map(t => (
                    <label key={t.value} className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                      selectedType === t.value ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/30 border-slate-700/40 hover:border-slate-600'
                    )}>
                      <input type="radio" name="btype" value={t.value} checked={selectedType === t.value}
                        onChange={() => setSelectedType(t.value)} className="mt-0.5 accent-emerald-500" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{t.label}</span>
                          <span className="text-[10px] text-slate-500">{t.engines}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{t.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Save Location */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Save to Location
                </label>
                <input
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  placeholder={`Default: ${diskStats?.path ?? '/home/vyndb/vyndb/backups'}`}
                  className="settings-input w-full font-mono text-xs"
                />
                <p className="text-[10px] text-slate-600 mt-1">
                  Absolute path on server. Leave blank to use default location.
                </p>
              </div>

              {/* Result */}
              {runResult && (
                <div className={cn('p-3 rounded-lg text-xs border', runResult.ok
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-red-500/10 text-red-400 border-red-500/20')}>
                  {runResult.ok
                    ? `✅ ${runResult.succeeded}/${runResult.total} backups succeeded`
                    : `⚠️ ${runResult.failed}/${runResult.total} backups failed — see table for details`
                  }
                </div>
              )}
            </div>

            <div className="flex gap-2 p-5 border-t border-slate-800/60">
              <button onClick={() => setShowRunModal(false)}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors">
                Close
              </button>
              <button onClick={handleRunBackup} disabled={running}
                className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {running ? <><Loader2 size={14} className="animate-spin" /> Running…</> : <><Play size={14} /> Run Now</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Schedule Add/Edit Modal ─────────────────────────────────────── */}
      {showSchedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowSchedModal(false)} />
          <div className="relative bg-[#0d1117] border border-slate-700/60 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-slate-800/60">
              <h3 className="text-base font-bold text-white">{editSchedId ? 'Edit Schedule' : 'New Backup Schedule'}</h3>
              <button onClick={() => setShowSchedModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Database */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Database</label>
                <select value={schedForm.dbId}
                  onChange={e => { const db = dbs.find(d => d.id === e.target.value); setSchedForm(f => ({ ...f, dbId: e.target.value, dbName: db?.name ?? '', engine: db?.engine ?? '' })) }}
                  className="settings-input w-full">
                  <option value="">Select a database…</option>
                  {dbs.filter(d => ['postgresql','mysql','mongodb','redis'].includes(d.engine)).map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.engine})</option>
                  ))}
                </select>
              </div>

              {/* Schedule preset */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Schedule</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {CRON_PRESETS.map(p => (
                    <button key={p.expr} onClick={() => setCronPreset(p.expr, p.label)}
                      className={cn('px-2 py-1 rounded text-[10px] font-medium border transition-colors',
                        schedForm.cronExpr === p.expr
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-white')}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <input value={schedForm.cronExpr}
                  onChange={e => setSchedForm(f => ({ ...f, cronExpr: e.target.value, cronLabel: 'Custom' }))}
                  placeholder="Custom cron (e.g. 0 2 * * *)"
                  className="settings-input w-full font-mono text-xs" />
                <p className="text-[10px] text-slate-600 mt-1">Format: minute hour day-of-month month day-of-week (UTC)</p>
              </div>

              {/* Backup type */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Backup Type</label>
                <div className="flex gap-2">
                  {(['full','schema-only','data-only'] as BackupType[]).map(t => (
                    <button key={t} onClick={() => setSchedForm(f => ({ ...f, backupType: t }))}
                      className={cn('flex-1 py-2 rounded-lg text-xs font-medium capitalize border transition-colors',
                        schedForm.backupType === t
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:text-white')}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Save Location (optional)</label>
                <input value={schedForm.location}
                  onChange={e => setSchedForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="Default: /home/vyndb/vyndb/backups"
                  className="settings-input w-full font-mono text-xs" />
                <p className="text-[10px] text-slate-600 mt-1">Absolute path on server. Leave blank for default location.</p>
              </div>

              {/* Retention */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Retention Override (days) <span className="text-slate-600 font-normal">— 0 = use global setting</span>
                </label>
                <input type="number" value={schedForm.retentionDays} min={0}
                  onChange={e => setSchedForm(f => ({ ...f, retentionDays: Number(e.target.value) }))}
                  className="settings-input w-32" />
              </div>
            </div>

            <div className="flex gap-2 p-5 border-t border-slate-800/60">
              <button onClick={() => setShowSchedModal(false)}
                className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveSchedule} disabled={savingSched || !schedForm.dbId}
                className="flex-1 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors">
                {savingSched ? 'Saving…' : editSchedId ? 'Update Schedule' : 'Create Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Detail Modal */}
      {selectedBackup && (() => {
        const b = selectedBackup
        const cfg = STATUS_CFG[b.status] ?? STATUS_CFG.scheduled
        const Icon = cfg.icon
        const duration = b.startedAt && b.completedAt
          ? Math.round((new Date(b.completedAt).getTime() - new Date(b.startedAt).getTime()) / 1000)
          : null
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedBackup(null)}>
            <div className="bg-[#0f1629] border border-slate-700 rounded-2xl w-full max-w-lg"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Icon className={cn('w-4 h-4', cfg.color, b.status === 'running' && 'animate-spin')} />
                  <span className="text-sm font-bold text-white">{b.dbName}</span>
                  <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', TYPE_COLOR[b.type] ?? 'bg-slate-700 text-slate-400')}>{b.type}</span>
                </div>
                <button onClick={() => setSelectedBackup(null)}><X size={14} className="text-slate-400 hover:text-white" /></button>
              </div>
              <div className="p-5 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">Status</div>
                    <div className={cn('font-bold', cfg.color)}>{b.status}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">Size</div>
                    <div className="font-bold text-white">{b.sizeMB > 0 ? (b.sizeMB >= 1024 ? `${(b.sizeMB/1024).toFixed(1)} GB` : `${b.sizeMB} MB`) : '—'}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">RPO</div>
                    <div className={cn('font-bold', b.rpoHrs > 24 ? 'text-red-400' : b.rpoHrs > 8 ? 'text-yellow-400' : 'text-emerald-400')}>{b.rpoHrs}h</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">RTO</div>
                    <div className="font-bold text-white">{b.rtoMins}m</div>
                  </div>
                  {duration !== null && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-slate-500 mb-1">Duration</div>
                      <div className="font-bold text-white">{duration >= 60 ? `${Math.floor(duration/60)}m ${duration%60}s` : `${duration}s`}</div>
                    </div>
                  )}
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">Backup ID</div>
                    <div className="font-mono text-slate-400 truncate">{b.id}</div>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="text-slate-500 mb-1">File Location</div>
                  <div className="font-mono text-slate-300 break-all">{b.location || '—'}</div>
                </div>
                <div className="space-y-1.5">
                  {b.scheduledAt && <div className="flex justify-between"><span className="text-slate-500">Scheduled</span><span className="text-slate-300">{new Date(b.scheduledAt).toLocaleString()}</span></div>}
                  {b.startedAt   && <div className="flex justify-between"><span className="text-slate-500">Started</span><span className="text-slate-300">{new Date(b.startedAt).toLocaleString()}</span></div>}
                  {b.completedAt && <div className="flex justify-between"><span className="text-slate-500">Completed</span><span className="text-slate-300">{new Date(b.completedAt).toLocaleString()}</span></div>}
                </div>
                {b.error && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <div className="text-red-400 font-semibold mb-1">Error</div>
                    <div className="text-red-300/80 font-mono break-all">{b.error}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

    </div>
  )
}
