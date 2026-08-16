'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Zap, Brain, Clock, AlertTriangle, Database, Filter, Search, Sparkles, Loader2, X, Check } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { useAppRefreshInterval } from '@/lib/use-app-refresh-interval'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10',
  high:     'text-orange-400 bg-orange-500/10',
  medium:   'text-yellow-400 bg-yellow-500/10',
  low:      'text-blue-400 bg-blue-500/10',
}

function DurationBadge({ ms }: { ms: number }) {
  const color = ms > 5000 ? 'text-red-400 bg-red-500/10' : ms > 2000 ? 'text-orange-400 bg-orange-500/10' : 'text-yellow-400 bg-yellow-500/10'
  return (
    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', color)}>
      {ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
    </span>
  )
}

export default function SlowQueriesPage() {
  const refreshInterval = useAppRefreshInterval(60)
  const { data: queries, mutate } = useSWR('/api/slow-queries', fetcher, { refreshInterval })
  const { data: dbs } = useSWR('/api/databases', fetcher)

  const list = Array.isArray(queries) ? queries : []
  const dbList = Array.isArray(dbs) ? dbs : []

  const [dbFilter, setDbFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'duration' | 'time'>('duration')
  const [selectedQ, setSelectedQ] = useState<{ id: string; query: string; dbName: string; engine: string; durationMs: number; rowsExamined?: number; rowsReturned?: number; executedAt: string; analyzed: boolean; aiAnalysis?: { explanation: string; bottleneck: string; suggestions: string[]; estimatedGain: string; indexSuggestions: string[]; confidence: number } } | null>(null)
  const [analyzing, setAnalyzing] = useState<string | null>(null)

  const filtered = list
    .filter((q: { dbId: string; query: string }) => (dbFilter === 'all' || q.dbId === dbFilter) && (!search || q.query.toLowerCase().includes(search.toLowerCase())))
    .sort((a: { durationMs: number; executedAt: string }, b: { durationMs: number; executedAt: string }) =>
      sortBy === 'duration' ? b.durationMs - a.durationMs : new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime()
    )

  const analyzeQuery = async (q: typeof selectedQ) => {
    if (!q) return
    setAnalyzing(q.id)
    try {
      const res = await fetch(`/api/slow-queries/${q.id}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        mutate()
        setSelectedQ({ ...q, analyzed: true, aiAnalysis: data.aiAnalysis })
      }
    } finally { setAnalyzing(null) }
  }

  const avgDuration = list.length ? Math.round(list.reduce((s: number, q: { durationMs: number }) => s + q.durationMs, 0) / list.length) : 0
  const maxDuration = list.length ? Math.max(...list.map((q: { durationMs: number }) => q.durationMs)) : 0

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Captured', value: list.length, icon: Zap, color: 'text-orange-400' },
          { label: 'AI Analyzed', value: list.filter((q: { analyzed: boolean }) => q.analyzed).length, icon: Brain, color: 'text-violet-400' },
          { label: 'Avg Duration', value: avgDuration >= 1000 ? `${(avgDuration / 1000).toFixed(1)}s` : `${avgDuration}ms`, icon: Clock, color: 'text-yellow-400' },
          { label: 'Slowest Query', value: maxDuration >= 1000 ? `${(maxDuration / 1000).toFixed(1)}s` : `${maxDuration}ms`, icon: AlertTriangle, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
            <s.icon className={cn('w-5 h-5 mb-2', s.color)} />
            <div className={cn('text-xl font-black', s.color)}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search queries..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60" />
        </div>
        <select value={dbFilter} onChange={e => setDbFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-slate-300">
          <option value="all">All Databases</option>
          {dbList.map((d: { id: string; name: string }) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as 'duration' | 'time')}
          className="px-3 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-slate-300">
          <option value="duration">Sort: Slowest first</option>
          <option value="time">Sort: Most recent</option>
        </select>
      </div>

      {/* Query list */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="divide-y divide-slate-800/60">
          {filtered.map((q: { id: string; query: string; durationMs: number; dbName: string; engine: string; executedAt: string; analyzed: boolean; rowsExamined?: number; rowsReturned?: number; aiAnalysis?: { explanation: string; bottleneck: string; suggestions: string[]; estimatedGain: string; indexSuggestions: string[]; confidence: number } }) => (
            <div key={q.id} className="p-4 hover:bg-slate-800/20 transition-colors cursor-pointer" onClick={() => setSelectedQ(q)}>
              <div className="flex items-start gap-3">
                <Zap className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <code className="text-xs text-slate-300 font-mono leading-relaxed line-clamp-2 block">{q.query}</code>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-slate-500">{q.dbName}</span>
                    <span className="text-[10px] text-slate-600">·</span>
                    <span className="text-[10px] text-slate-500 capitalize">{q.engine}</span>
                    {q.rowsExamined && <><span className="text-[10px] text-slate-600">·</span><span className="text-[10px] text-slate-500">{q.rowsExamined.toLocaleString()} rows scanned</span></>}
                    <span className="text-[10px] text-slate-600">·</span>
                    <span className="text-[10px] text-slate-500">{timeAgo(q.executedAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <DurationBadge ms={q.durationMs} />
                  {q.analyzed
                    ? <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">AI analyzed</span>
                    : <span className="text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full">Not analyzed</span>
                  }
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No slow queries found
            </div>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selectedQ && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedQ(null)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <DurationBadge ms={selectedQ.durationMs} />
                <span className="text-sm font-bold text-white">{selectedQ.dbName}</span>
              </div>
              <button onClick={() => setSelectedQ(null)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Query</h4>
                <pre className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">{selectedQ.query}</pre>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {selectedQ.rowsExamined && <div className="p-3 rounded-xl bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Rows Examined</div><div className="text-white font-bold">{selectedQ.rowsExamined.toLocaleString()}</div></div>}
                {selectedQ.rowsReturned && <div className="p-3 rounded-xl bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Rows Returned</div><div className="text-white font-bold">{selectedQ.rowsReturned.toLocaleString()}</div></div>}
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Engine</div><div className="text-white font-bold capitalize">{selectedQ.engine}</div></div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Executed</div><div className="text-white font-bold">{timeAgo(selectedQ.executedAt)}</div></div>
              </div>

              {selectedQ.aiAnalysis ? (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-400 uppercase">AI Analysis</h4>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-700">
                    <div className="text-xs text-slate-400 mb-1 font-semibold">Explanation</div>
                    <p className="text-xs text-slate-300">{selectedQ.aiAnalysis.explanation}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/20">
                    <div className="text-xs text-orange-400 mb-1 font-semibold">Bottleneck</div>
                    <p className="text-xs text-slate-300">{selectedQ.aiAnalysis.bottleneck}</p>
                  </div>
                  {selectedQ.aiAnalysis.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                      {s}
                    </div>
                  ))}
                  {selectedQ.aiAnalysis.indexSuggestions.map((idx, i) => (
                    <pre key={i} className="p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-emerald-300 font-mono overflow-x-auto whitespace-pre-wrap">{idx}</pre>
                  ))}
                </div>
              ) : (
                <button onClick={() => analyzeQuery(selectedQ)} disabled={analyzing === selectedQ.id}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
                  {analyzing === selectedQ.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {analyzing === selectedQ.id ? 'Analyzing with AI…' : 'Analyze with AI'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
