'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Activity, AlertTriangle, Database, Lock, Shield, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(response => response.json())

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
  const { data, isLoading, mutate } = useSWR<DiagnosticData>(
    databaseId ? `/api/databases/${databaseId}/diagnostics` : null,
    fetcher,
  )

  const list = Array.isArray(databases) ? databases : []
  const selected = list.find(database => database.id === databaseId)
  const cards = [
    { label: 'Locks', value: data?.locks?.length ?? 0, icon: Lock, color: 'text-yellow-400' },
    { label: 'Blockers', value: data?.blockers?.length ?? 0, icon: AlertTriangle, color: 'text-red-400' },
    { label: 'Waits', value: data?.waits?.length ?? 0, icon: Timer, color: 'text-orange-400' },
    { label: 'Deadlock evidence', value: data?.deadlocks?.length ?? 0, icon: Activity, color: 'text-violet-400' },
  ]

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-emerald-400" /> Database Diagnostics</h1>
          <p className="text-xs text-slate-500 mt-1">Read-only evidence for locks, waits, blockers, and deadlocks.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={databaseId} onChange={event => setDatabaseId(event.target.value)} className="settings-input min-w-56">
            <option value="">Select a database</option>
            {list.map(database => <option key={database.id} value={database.id}>{database.name} ({database.engine})</option>)}
          </select>
          <button onClick={() => mutate()} disabled={!databaseId || isLoading} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs text-slate-300">Refresh</button>
        </div>
      </div>

      {!databaseId && (
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-10 text-center">
          <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Select a database to inspect live diagnostic evidence.</p>
        </div>
      )}

      {databaseId && data && (
        <>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{selected?.name ?? data.dbName}</span><span className="text-slate-700">·</span><span className="capitalize">{data.engine}</span>
            <span className={cn('px-2 py-0.5 rounded-full', data.dataQuality === 'real' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-400')}>{data.dataQuality} data</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(card => {
              const Icon = card.icon
              return <div key={card.label} className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4"><Icon className={cn('w-4 h-4 mb-2', card.color)} /><div className="text-2xl font-black text-white">{card.value}</div><div className="text-xs text-slate-500">{card.label}</div></div>
            })}
          </div>
          {data.warnings.length > 0 && <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 p-4 space-y-1"><div className="text-xs font-bold text-yellow-400 flex items-center gap-2"><Shield className="w-3.5 h-3.5" /> Collection notes</div>{data.warnings.map((warning, index) => <p key={index} className="text-xs text-yellow-200/70">{warning}</p>)}</div>}
          <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5"><h2 className="text-sm font-bold text-white mb-3">Blocking evidence</h2>{data.blockers.length === 0 ? <p className="text-xs text-emerald-400">No blocking sessions reported.</p> : <pre className="text-xs text-slate-300 overflow-auto whitespace-pre-wrap">{JSON.stringify(data.blockers, null, 2)}</pre>}</div>
        </>
      )}
    </div>
  )
}