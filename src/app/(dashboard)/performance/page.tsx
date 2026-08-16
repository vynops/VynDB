'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { Activity, Cpu, HardDrive, Database } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppRefreshInterval } from '@/lib/use-app-refresh-interval'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const RANGES = [
  { label: '1h',  hours: 1  },
  { label: '6h',  hours: 6  },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
]

function MetricCard({ label, value, unit, color, sub }: { label: string; value: string | number; unit?: string; color: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-[#0a0f1e] border border-slate-800 p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={cn('text-xl font-black', color)}>{value}{unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}</div>
      {sub && <div className="text-[10px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function PerformancePage() {
  const refreshInterval = useAppRefreshInterval(30)
  const { data: dbs } = useSWR('/api/databases', fetcher)
  const dbList = Array.isArray(dbs) ? dbs : []
  const [selectedDb, setSelectedDb] = useState<string>('')
  const [range, setRange] = useState(24)

  const dbId = selectedDb || (dbList[0] as { id: string } | undefined)?.id || ''
  const { data: perfData } = useSWR(dbId ? `/api/performance?dbId=${dbId}&hours=${range}` : null, fetcher, { refreshInterval })

  const snapshots = Array.isArray(perfData) ? perfData : []
  const latest = snapshots[snapshots.length - 1]

  // Format time for chart labels
  const chartData = snapshots.map((s: { timestamp: string; tps: number; latencyP95Ms: number; latencyP99Ms: number; activeConnections: number; maxConnections: number; cpuPct: number; memPct: number; cacheHitRatio: number; diskReadMBps: number; diskWriteMBps: number }) => ({
    ...s,
    time: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    connPct: Math.round((s.activeConnections / s.maxConnections) * 100),
  }))

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select value={dbId} onChange={e => setSelectedDb(e.target.value)}
          className="px-3 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-slate-300 flex-1">
          {dbList.map((d: { id: string; name: string; engine: string }) => (
            <option key={d.id} value={d.id}>{d.name} ({d.engine})</option>
          ))}
        </select>
        <div className="flex gap-1 bg-[#0f1629] border border-slate-700 rounded-xl p-1">
          {RANGES.map(r => (
            <button key={r.label} onClick={() => setRange(r.hours)}
              className={cn('px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                range === r.hours ? 'bg-emerald-500/20 text-emerald-400' : 'text-slate-500 hover:text-slate-300')}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Current stats */}
      {latest && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <MetricCard label="TPS" value={latest.tps} color="text-emerald-400" sub="transactions/sec" />
          <MetricCard label="Latency p50" value={latest.latencyP50Ms} unit="ms" color="text-blue-400" />
          <MetricCard label="Latency p95" value={latest.latencyP95Ms} unit="ms" color="text-yellow-400" />
          <MetricCard label="Latency p99" value={latest.latencyP99Ms} unit="ms" color={latest.latencyP99Ms > 100 ? 'text-red-400' : 'text-orange-400'} />
          <MetricCard label="Connections" value={`${latest.activeConnections}/${latest.maxConnections}`} color="text-violet-400" sub={`${Math.round(latest.activeConnections / latest.maxConnections * 100)}% used`} />
          <MetricCard label="Cache Hit" value={latest.cacheHitRatio} unit="%" color={latest.cacheHitRatio >= 95 ? 'text-emerald-400' : 'text-yellow-400'} />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">

        {/* TPS Chart */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white mb-4">Transactions per Second</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#10b981' }} />
              <Area type="monotone" dataKey="tps" stroke="#10b981" fill="url(#tpsGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Latency Chart */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white mb-4">Query Latency (ms)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} />
              <Line type="monotone" dataKey="latencyP50Ms" name="p50" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="latencyP95Ms" name="p95" stroke="#facc15" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="latencyP99Ms" name="p99" stroke="#f87171" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-3 mt-2">
            {[{ label: 'p50', color: 'bg-blue-400' }, { label: 'p95', color: 'bg-yellow-400' }, { label: 'p99', color: 'bg-red-400' }].map(l => (
              <div key={l.label} className="flex items-center gap-1.5 text-xs text-slate-400">
                <div className={cn('w-3 h-0.5', l.color)} />
                {l.label}
              </div>
            ))}
          </div>
        </div>

        {/* CPU & Memory */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white mb-4">CPU & Memory Usage (%)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} />
              <Area type="monotone" dataKey="cpuPct" name="CPU %" stroke="#a78bfa" fill="url(#cpuGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="memPct" name="Mem %" stroke="#34d399" fill="url(#memGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Connections */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white mb-4">Connection Pool Utilisation (%)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="connGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fb923c" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#fb923c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: '#475569', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }} labelStyle={{ color: '#94a3b8' }} />
              <Area type="monotone" dataKey="connPct" name="Conn %" stroke="#fb923c" fill="url(#connGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
