'use client'

import useSWR from 'swr'
import { BarChart3, TrendingUp, AlertTriangle, HardDrive } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function GB(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

export default function CapacityPage() {
  const { data: capacity } = useSWR('/api/capacity', fetcher, { refreshInterval: 120000 })
  const list = Array.isArray(capacity) ? capacity : []

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* DB Capacity Cards */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map((cap: { dbId: string; dbName: string; totalSizeMB: number; dataSizeMB: number; indexSizeMB: number; freeSizeMB: number; growthMBPerDay: number; daysUntilFull: number; indexBloatPct: number; tableBloatPct: number; topTables: { name: string; sizeMB: number; growthMBPerDay: number }[] }) => {
          const usedPct = cap.totalSizeMB > 0 ? Math.min(100, Math.round(((cap.totalSizeMB - cap.freeSizeMB) / cap.totalSizeMB) * 100)) : 0
          const hasGrowth = cap.growthMBPerDay > 0
          const urgency = hasGrowth && cap.daysUntilFull < 14 ? 'critical' : hasGrowth && cap.daysUntilFull < 45 ? 'warning' : 'ok'
          return (
            <div key={cap.dbId} className={cn('rounded-2xl border p-5 space-y-4', urgency === 'critical' ? 'bg-red-500/3 border-red-500/20' : urgency === 'warning' ? 'bg-yellow-500/3 border-yellow-500/20' : 'bg-[#0f1629] border-slate-800')}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">{cap.dbName}</h3>
                  <p className="text-xs text-slate-500">{GB(cap.totalSizeMB)} total</p>
                </div>
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                  urgency === 'critical' ? 'bg-red-500/10 text-red-400' : urgency === 'warning' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-emerald-500/10 text-emerald-400')}>
                  {hasGrowth ? `${cap.daysUntilFull}d until full` : 'stable'}
                </span>
              </div>

              {/* Usage bar */}
              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Storage used</span>
                  <span>{usedPct}%</span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', urgency === 'critical' ? 'bg-red-500' : urgency === 'warning' ? 'bg-yellow-500' : 'bg-emerald-500')} style={{ width: `${usedPct}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                  <span>Used: {GB(cap.totalSizeMB - cap.freeSizeMB)}</span>
                  <span>Free: {GB(cap.freeSizeMB)}</span>
                </div>
              </div>

              {/* Breakdown */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-slate-900/50">
                  <div className="text-xs font-bold text-slate-300">{GB(cap.dataSizeMB)}</div>
                  <div className="text-[9px] text-slate-500">Data</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/50">
                  <div className="text-xs font-bold text-blue-300">{GB(cap.indexSizeMB)}</div>
                  <div className="text-[9px] text-slate-500">Indexes</div>
                </div>
                <div className="p-2 rounded-lg bg-slate-900/50">
                  <div className="text-xs font-bold text-orange-300">{cap.growthMBPerDay >= 1024 ? `${(cap.growthMBPerDay / 1024).toFixed(1)} GB` : `${cap.growthMBPerDay} MB`}/d</div>
                  <div className="text-[9px] text-slate-500">Growth</div>
                </div>
              </div>

              {/* Bloat */}
              {(cap.indexBloatPct > 10 || cap.tableBloatPct > 10) && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-orange-500/5 border border-orange-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                  <span className="text-xs text-orange-300">Index bloat {cap.indexBloatPct}% · Table bloat {cap.tableBloatPct}%</span>
                </div>
              )}

              {/* Top tables */}
              {cap.topTables.length > 0 && (
                <div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase mb-1.5">
                    {hasGrowth ? 'Top tables by growth' : 'Top tables by size'}
                  </div>
                  {cap.topTables.map(t => (
                    <div key={t.name} className="flex items-center gap-2 py-1">
                      <span className="text-[11px] text-slate-300 flex-1 truncate font-mono">{t.name}</span>
                      <span className="text-[10px] text-slate-400">{GB(t.sizeMB)}</span>
                      {t.growthMBPerDay > 0 && <span className="text-[10px] text-yellow-400">+{t.growthMBPerDay}MB/d</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Bloat remediation */}
      {list.some((c: { indexBloatPct: number }) => c.indexBloatPct > 10) && (
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-orange-400" /> Index Bloat Remediation
          </h3>
          <div className="space-y-2 text-xs">
            {list
              .filter((c: { indexBloatPct: number }) => c.indexBloatPct > 10)
              .map((c: { dbId: string; dbName: string; engine: string; indexBloatPct: number }) => {
                const cmd = c.engine === 'postgresql'
                  ? 'REINDEX DATABASE CONCURRENTLY ' + c.dbName + ';  -- rebuilds all indexes, no table lock'
                  : c.engine === 'mysql'
                  ? 'OPTIMIZE TABLE <table_name>;  -- reclaims InnoDB free space'
                  : c.engine === 'mongodb'
                  ? 'db.runCommand({ reIndex: "<collection>" })'
                  : 'See engine documentation for index rebuild'
                return (
                  <div key={c.dbId} className="p-3 rounded-xl bg-slate-900 border border-slate-700">
                    <div className="text-slate-500 mb-1">{c.dbName} · bloat {c.indexBloatPct}%</div>
                    <code className="text-emerald-300 font-mono">{cmd}</code>
                  </div>
                )
              })
            }
          </div>
        </div>
      )}
    </div>
  )
}
