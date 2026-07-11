'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Shield, AlertTriangle, CheckCircle, Lock, Eye, UserX } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SEV_COLOR: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium:   'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low:      'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  info:     'bg-slate-700 text-slate-400',
}

const CAT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  privilege:   UserX,
  encryption:  Lock,
  auth:        Shield,
  config:      Eye,
  compliance:  CheckCircle,
}

export default function SecurityPage() {
  const { data: findings } = useSWR('/api/security', fetcher, { refreshInterval: 60000 })
  const { data: dbs } = useSWR('/api/databases', fetcher)
  const list = Array.isArray(findings) ? findings : []
  const dbList = Array.isArray(dbs) ? dbs : []

  // Build dbId → {name, engine} map
  const dbMap = Object.fromEntries(dbList.map((d: { id: string; name: string; engine: string }) => [d.id, d]))

  const critical = list.filter((f: { severity: string; status: string }) => f.severity === 'critical' && f.status === 'open').length
  const high = list.filter((f: { severity: string; status: string }) => f.severity === 'high' && f.status === 'open').length
  const open = list.filter((f: { status: string }) => f.status === 'open').length
  const score = list.length ? Math.max(0, 100 - critical * 25 - high * 10 - Math.floor(open * 2)) : 100

  // Group findings by DB
  const byDb = new Map<string, { dbId: string; dbName: string; engine: string; open: number; total: number; categories: Set<string> }>()
  for (const f of list as { dbId: string; dbName: string; status: string; category: string }[]) {
    if (!byDb.has(f.dbId)) {
      const db = dbMap[f.dbId]
      byDb.set(f.dbId, { dbId: f.dbId, dbName: f.dbName, engine: db?.engine ?? 'unknown', open: 0, total: 0, categories: new Set() })
    }
    const entry = byDb.get(f.dbId)!
    entry.total++
    if (f.status === 'open') entry.open++
    entry.categories.add(f.category)
  }
  // Also add DBs with no findings (fully clean)
  for (const db of dbList as { id: string; name: string; engine: string }[]) {
    if (!byDb.has(db.id)) {
      byDb.set(db.id, { dbId: db.id, dbName: db.name, engine: db.engine, open: 0, total: 0, categories: new Set() })
    }
  }
  const dbSummaries = [...byDb.values()].sort((a, b) => b.open - a.open)
  const [filterDb, setFilterDb] = useState<string | null>(null)
  const filteredList = filterDb ? list.filter((f: { dbId: string }) => f.dbId === filterDb) : list

  const handleAck = async (id: string) => {
    await fetch(`/api/security/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'acknowledged' }) })
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Score */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 sm:col-span-1">
          <Shield className={cn('w-6 h-6 mb-2', score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400')} />
          <div className={cn('text-3xl font-black', score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400')}>{score}</div>
          <div className="text-xs text-slate-500 mt-0.5">Security Score /100</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
          <AlertTriangle className="w-4 h-4 text-red-400 mb-2" />
          <div className="text-xl font-black text-red-400">{critical}</div>
          <div className="text-xs text-slate-500">Critical</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
          <AlertTriangle className="w-4 h-4 text-orange-400 mb-2" />
          <div className="text-xl font-black text-orange-400">{high}</div>
          <div className="text-xs text-slate-500">High</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
          <CheckCircle className="w-4 h-4 text-emerald-400 mb-2" />
          <div className="text-xl font-black text-slate-300">{list.filter((f: { status: string }) => f.status === 'resolved').length}</div>
          <div className="text-xs text-slate-500">Resolved</div>
        </div>
      </div>

      {/* Security summary per DB — click to filter findings below */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
        <h3 className="text-sm font-bold text-white mb-1">Security Check Summary</h3>
        <p className="text-xs text-slate-500 mb-3">Click a database to filter findings below</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {dbSummaries.map(b => {
            const passedChecks = b.total - b.open
            const score = b.total === 0 ? 100 : Math.round((passedChecks / b.total) * 100)
            const color = b.open === 0 ? 'text-emerald-400' : b.open <= 1 ? 'text-yellow-400' : 'text-red-400'
            const barColor = b.open === 0 ? 'bg-emerald-500' : b.open <= 1 ? 'bg-yellow-500' : 'bg-red-500'
            return (
              <div key={b.dbId} onClick={() => setFilterDb(filterDb === b.dbId ? null : b.dbId)}
                className={cn('p-3 rounded-xl border cursor-pointer transition-colors',
                  filterDb === b.dbId
                    ? 'bg-slate-700 border-slate-500'
                    : 'bg-slate-900 border-slate-700 hover:border-slate-600'
                )}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="text-xs font-semibold text-slate-300">{b.dbName}</span>
                    <span className="text-[9px] text-slate-600 ml-1.5 capitalize">{b.engine}</span>
                  </div>
                  <span className={cn('text-xs font-black', color)}>
                    {b.open === 0 ? '✓ Clean' : `${b.open} open`}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mb-1">
                  <div className={cn('h-full rounded-full', barColor)}
                    style={{ width: `${b.total === 0 ? 100 : score}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>{b.total === 0 ? 'No findings' : `${passedChecks}/${b.total} checks clean`}</span>
                  {b.categories.size > 0 && (
                    <span className="text-slate-600">{[...b.categories].join(', ')}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Findings list */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white">Security Findings</h2>
              <p className="text-xs text-slate-500">{open} open findings requiring attention</p>
            </div>
            {filterDb && (
              <button onClick={() => setFilterDb(null)}
                className="text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
                × Clear filter
              </button>
            )}
          </div>
        </div>
        <div className="divide-y divide-slate-800/60">
          {filteredList.map((f: { id: string; dbName: string; severity: string; category: string; title: string; description: string; recommendation: string; detectedAt: string; status: string }) => {
            const CatIcon = CAT_ICON[f.category] ?? Shield
            return (
              <div key={f.id} className={cn('p-5 transition-colors', f.status === 'resolved' && 'opacity-50')}>
                <div className="flex items-start gap-3">
                  <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', SEV_COLOR[f.severity])}>
                    <CatIcon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white">{f.title}</span>
                      <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', SEV_COLOR[f.severity])}>{f.severity}</span>
                      <span className="text-[9px] text-slate-500 uppercase">{f.category}</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-2 leading-relaxed">{f.description}</p>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 mb-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-300/80 leading-relaxed">{f.recommendation}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500">{f.dbName} · {timeAgo(f.detectedAt)}</span>
                      <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase',
                        f.status === 'open' ? 'bg-red-500/10 text-red-400' :
                        f.status === 'acknowledged' ? 'bg-yellow-500/10 text-yellow-400' :
                        'bg-emerald-500/10 text-emerald-400')}>
                        {f.status}
                      </span>
                      {f.status === 'open' && (
                        <button onClick={() => handleAck(f.id)} className="text-[10px] text-slate-400 hover:text-white border border-slate-700 hover:border-slate-600 px-2 py-0.5 rounded-lg transition-colors">
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          {list.length === 0 && (
            <div className="p-10 text-center">
              <Shield className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-emerald-400 font-medium">No security findings — your databases look secure</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
