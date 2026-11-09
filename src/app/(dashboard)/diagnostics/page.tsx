'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Activity, AlertTriangle, Database, Lock, Shield, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = async (url: string) => {
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`)
  return body
}

type DatabaseItem = { id: string; name: string; engine: string }
type DiagnosticData = {
  dbName: string
  engine: string
  dataQuality: string
  locks: unknown[]
  blockers: unknown[]
  waits: unknown[]
  deadlocks: unknown[]
  warnings: string[]
}

export default function DiagnosticsPage() {
  const { data: databases } = useSWR<DatabaseItem[]>('/api/databases', fetcher)
  const [databaseId, setDatabaseId] = useState('')
  const { data, error, isLoading, mutate } = useSWR<DiagnosticData>(
    databaseId ? `/api/databases/${databaseId}/diagnostics` : null,
    fetcher,
  )

  const list = Array.isArray(databases) ? databases : []
  const selected = list.find(database => database.id === databaseId)
  const postgresDeadlockStats = data?.engine === 'postgresql'
    ? data.deadlocks?.[0] as { deadlocks?: number; stats_reset?: string } | undefined
    : undefined
  const engine = data?.engine ?? ''
  const supportsLocks = ['postgresql', 'mysql', 'sqlserver', 'redis'].includes(engine)
  const supportsBlockers = ['postgresql', 'sqlserver'].includes(engine)
  const supportsWaits = ['postgresql', 'mysql', 'sqlserver', 'mongodb'].includes(engine)
  const hasDeadlockCounter = typeof postgresDeadlockStats?.deadlocks === 'number'
  const cards = [
    {
      target: 'lock-evidence', label: engine === 'redis' ? 'Clients' : engine === 'mysql' ? 'InnoDB transactions' : engine === 'sqlserver' ? 'Active requests' : 'Lock conflicts',
      value: supportsLocks ? data?.locks?.length ?? 0 : '—', available: supportsLocks,
      icon: Lock, color: 'text-yellow-400',
    },
    {
      target: 'blocking-evidence', label: 'Blockers',
      value: supportsBlockers ? data?.blockers?.length ?? 0 : '—', available: supportsBlockers,
      icon: AlertTriangle, color: 'text-red-400',
    },
    {
      target: 'wait-evidence', label: engine === 'mongodb' ? 'Active operations' : engine === 'mysql' ? 'Process states' : 'Waits',
      value: supportsWaits ? data?.waits?.length ?? 0 : '—', available: supportsWaits,
      icon: Timer, color: 'text-orange-400',
    },
    {
      target: 'deadlock-evidence', label: engine === 'postgresql' ? 'Deadlocks since reset' : 'Deadlock history',
      value: hasDeadlockCounter ? postgresDeadlockStats!.deadlocks! : '—', available: hasDeadlockCounter,
      icon: Activity, color: 'text-violet-400',
    },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <select value={databaseId} onChange={event => setDatabaseId(event.target.value)} className="px-3 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-slate-300 flex-1 min-w-0">
          <option value="">Select a database</option>
          {list.map(database => <option key={database.id} value={database.id}>{database.name} ({database.engine})</option>)}
        </select>
        <button onClick={() => mutate()} disabled={!databaseId || isLoading} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs text-slate-300">Refresh</button>
      </div>

      {!databaseId && (
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-10 text-center">
          <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Select a database to inspect live diagnostic evidence.</p>
        </div>
      )}

      {databaseId && error && (
        <div role="alert" className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 text-sm text-red-300">
          Could not load diagnostics: {error.message}
        </div>
      )}

      {databaseId && data && !error && (
        <>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{selected?.name ?? data.dbName}</span><span className="text-slate-700">·</span><span className="capitalize">{data.engine}</span>
            <span className={cn('px-2 py-0.5 rounded-full', data.dataQuality === 'real' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-400')}>{data.dataQuality} data</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(card => {
              const Icon = card.icon
              return <a key={card.target} href={`#${card.target}`} aria-label={`${card.label}: ${card.available ? card.value : 'unavailable'}; jump to evidence`}
                className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4 hover:border-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors">
                <Icon className={cn('w-4 h-4 mb-2', card.color)} />
                <div className={cn('text-2xl font-black', card.available ? 'text-white' : 'text-slate-500')}>{card.value}</div>
                <div className="text-xs text-slate-500">{card.label}</div>
                <div className="text-[10px] text-slate-600 mt-1">{card.available ? 'View evidence' : 'Not collected'}</div>
              </a>
            })}
          </div>
          {data.warnings.length > 0 && <div id="collection-notes" className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 p-4 space-y-1 scroll-mt-6"><div className="text-xs font-bold text-yellow-400 flex items-center gap-2"><Shield className="w-3.5 h-3.5" /> Collection notes</div>{data.warnings.map((warning, index) => <p key={index} className="text-xs text-yellow-200/70">{warning}</p>)}</div>}
          <div id="lock-evidence" className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 scroll-mt-6">
            <h2 className="text-sm font-bold text-white mb-3">{engine === 'redis' ? 'Client activity' : engine === 'mysql' ? 'InnoDB transactions' : engine === 'sqlserver' ? 'Active requests' : 'Lock conflict evidence'}</h2>
            {!supportsLocks ? <p className="text-xs text-slate-400">Lock details are not collected for {engine || 'this engine'}.</p>
              : data.locks.length === 0 ? <p className="text-xs text-slate-400">No lock evidence returned.</p>
              : <pre className="text-xs text-slate-300 overflow-auto whitespace-pre-wrap">{JSON.stringify(data.locks, null, 2)}</pre>}
          </div>
          <div id="blocking-evidence" className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 scroll-mt-6">
            <h2 className="text-sm font-bold text-white mb-3">Blocking evidence</h2>
            {!supportsBlockers ? <p className="text-xs text-slate-400">Blocker details are not collected for {engine || 'this engine'}.</p>
              : data.blockers.length === 0 ? <p className="text-xs text-slate-400">No blocking sessions reported.</p>
              : <pre className="text-xs text-slate-300 overflow-auto whitespace-pre-wrap">{JSON.stringify(data.blockers, null, 2)}</pre>}
          </div>
          <div id="wait-evidence" className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 scroll-mt-6">
            <h2 className="text-sm font-bold text-white mb-3">{engine === 'mongodb' ? 'Active operations' : engine === 'mysql' ? 'Process states with activity' : 'Wait evidence'}</h2>
            {!supportsWaits ? <p className="text-xs text-slate-400">Wait details are not collected for {engine || 'this engine'}.</p>
              : data.waits.length === 0 ? <p className="text-xs text-slate-400">No current waits or active operations reported.</p>
              : <pre className="text-xs text-slate-300 overflow-auto whitespace-pre-wrap">{JSON.stringify(data.waits, null, 2)}</pre>}
          </div>
          <div id="deadlock-evidence" className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 scroll-mt-6">
            <h2 className="text-sm font-bold text-white mb-3">Deadlock evidence</h2>
            {postgresDeadlockStats ? (
              <div className="space-y-1 text-xs text-slate-300">
                <p>{postgresDeadlockStats.deadlocks ?? 0} cumulative deadlock(s) since PostgreSQL statistics were reset.</p>
                <p className="text-slate-500">Statistics reset: {postgresDeadlockStats.stats_reset ? new Date(postgresDeadlockStats.stats_reset).toLocaleString() : 'unknown'}</p>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap">{JSON.stringify(postgresDeadlockStats, null, 2)}</pre>
              </div>
            ) : !data.deadlocks.length ? (
              <p className="text-xs text-slate-400">Deadlock history is not collected for {engine || 'this engine'}.</p>
            ) : (
              <pre className="text-xs text-slate-300 overflow-auto whitespace-pre-wrap">{JSON.stringify(data.deadlocks, null, 2)}</pre>
            )}
          </div>
        </>
      )}
    </div>
  )
}