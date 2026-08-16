'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { Activity, AlertTriangle, Database, Zap, Shield, HardDrive, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, RefreshCw } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { useAppRefreshInterval } from '@/lib/use-app-refresh-interval'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const ENGINE_COLORS: Record<string, string> = {
  postgresql: 'text-indigo-400 bg-indigo-500/10',
  mysql:      'text-yellow-400 bg-yellow-500/10',
  sqlserver:  'text-blue-400 bg-blue-500/10',
  mongodb:    'text-green-400 bg-green-500/10',
  redis:      'text-orange-400 bg-orange-500/10',
  couchbase:  'text-purple-400 bg-purple-500/10',
}

const STATUS_COLOR: Record<string, string> = {
  connected: 'bg-emerald-500/20 text-emerald-400',
  warning:   'bg-yellow-500/20 text-yellow-400',
  error:     'bg-red-500/20 text-red-400',
  unknown:   'bg-slate-500/20 text-slate-400',
}

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400',
  high:     'text-orange-400',
  medium:   'text-yellow-400',
  low:      'text-blue-400',
}

function Stat({ label, value, sub, color = 'text-white', icon: Icon, href }: {
  label: string; value: string | number; sub?: string; color?: string;
  icon: React.ComponentType<{ className?: string }>; href?: string
}) {
  const inner = (
    <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 hover:border-slate-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <Icon className={cn('w-5 h-5', color)} />
      </div>
      <div className={cn('text-2xl font-black', color)}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5 font-medium">{label}</div>
      {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
    </div>
  )
  if (href) return <Link href={href}>{inner}</Link>
  return inner
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-emerald-500' : score >= 70 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-400 w-8 text-right">{score}</span>
    </div>
  )
}

export default function OverviewPage() {
  const refreshInterval = useAppRefreshInterval(30)
  const { data: dbs } = useSWR('/api/databases', fetcher, { refreshInterval })
  const { data: incidents } = useSWR('/api/incidents', fetcher, { refreshInterval })
  const { data: slowQ } = useSWR('/api/slow-queries', fetcher, { refreshInterval })
  const { data: backups } = useSWR('/api/backups', fetcher, { refreshInterval })

  const dbList = Array.isArray(dbs) ? dbs : []
  const incList = Array.isArray(incidents) ? incidents : []
  const sqList = Array.isArray(slowQ) ? slowQ : []
  const bkList = Array.isArray(backups) ? backups : []

  const healthy = dbList.filter((d: { status: string }) => d.status === 'connected').length
  const warning = dbList.filter((d: { status: string }) => d.status === 'warning').length
  const openInc = incList.filter((i: { status: string }) => i.status === 'open').length
  const critInc = incList.filter((i: { status: string; severity: string }) => i.status === 'open' && i.severity === 'critical').length
  const failedBk = bkList.filter((b: { status: string }) => b.status === 'failed').length
  const avgHealth = dbList.length ? Math.round(dbList.reduce((s: number, d: { healthScore: number }) => s + d.healthScore, 0) / dbList.length) : 0

  const recentIncidents = incList
    .filter((i: { status: string }) => i.status !== 'resolved')
    .slice(0, 5)

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Stat icon={Database} label="Total Databases" value={dbList.length} color="text-emerald-400" href="/databases" />
        <Stat icon={CheckCircle} label="Healthy" value={healthy} color="text-emerald-400" href="/databases" />
        <Stat icon={AlertTriangle} label="Warning" value={warning} color="text-yellow-400" href="/databases" />
        <Stat icon={Activity} label="Avg Health Score" value={`${avgHealth}/100`} color={avgHealth >= 90 ? 'text-emerald-400' : avgHealth >= 70 ? 'text-yellow-400' : 'text-red-400'} />
        <Stat icon={XCircle} label="Open Incidents" value={openInc} sub={critInc > 0 ? `${critInc} critical` : undefined} color={openInc > 0 ? 'text-red-400' : 'text-slate-400'} href="/incidents" />
        <Stat icon={Zap} label="Slow Queries Today" value={sqList.length} color="text-orange-400" href="/slow-queries" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">

        {/* DB Fleet */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white">Database Fleet</h2>
              <p className="text-xs text-slate-500">{dbList.length} instances monitored</p>
            </div>
            <Link href="/databases" className="text-xs text-emerald-400 hover:text-emerald-300">View all →</Link>
          </div>
          <div className="divide-y divide-slate-800/60">
            {dbList.slice(0, 7).map((db: { id: string; name: string; engine: string; environment: string; status: string; healthScore: number; version?: string; lastChecked: string }) => (
              <div key={db.id} className="flex items-center gap-3 px-5 py-3">
                <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[10px] font-black', ENGINE_COLORS[db.engine] ?? 'text-slate-400 bg-slate-800')}>
                  {db.engine.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white truncate">{db.name}</span>
                    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase', STATUS_COLOR[db.status])}>{db.status}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <HealthBar score={db.healthScore} />
                    <span className="text-[10px] text-slate-600 flex-shrink-0">{timeAgo(db.lastChecked)}</span>
                  </div>
                </div>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', db.environment === 'production' ? 'bg-red-500/10 text-red-400' : 'bg-slate-700 text-slate-400')}>
                  {db.environment.slice(0, 4)}
                </span>
              </div>
            ))}
            {dbList.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-slate-500">
                No databases connected yet. <Link href="/databases" className="text-emerald-400">Add one →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Active Incidents */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white">Active Incidents</h2>
              <p className="text-xs text-slate-500">{openInc} open · {incList.filter((i: { status: string }) => i.status === 'acknowledged').length} acknowledged</p>
            </div>
            <Link href="/incidents" className="text-xs text-emerald-400 hover:text-emerald-300">View all →</Link>
          </div>
          <div className="divide-y divide-slate-800/60">
            {recentIncidents.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-emerald-400">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                All clear — no open incidents
              </div>
            ) : recentIncidents.map((inc: { id: string; title: string; severity: string; status: string; dbName: string; category: string; createdAt: string }) => (
              <div key={inc.id} className="flex items-start gap-3 px-5 py-3">
                <AlertTriangle className={cn('w-4 h-4 flex-shrink-0 mt-0.5', SEV_COLOR[inc.severity])} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white leading-snug truncate">{inc.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-500">{inc.dbName}</span>
                    <span className="text-[10px] text-slate-600">·</span>
                    <span className="text-[10px] text-slate-500">{timeAgo(inc.createdAt)}</span>
                  </div>
                </div>
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase flex-shrink-0',
                  inc.status === 'acknowledged' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400')}>
                  {inc.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Slow Queries */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white">Recent Slow Queries</h2>
              <p className="text-xs text-slate-500">Top queries by duration</p>
            </div>
            <Link href="/slow-queries" className="text-xs text-emerald-400 hover:text-emerald-300">View all →</Link>
          </div>
          <div className="divide-y divide-slate-800/60">
            {sqList.slice(0, 5).map((q: { id: string; query: string; durationMs: number; dbName: string; executedAt: string; analyzed: boolean }) => (
              <div key={q.id} className="flex items-start gap-3 px-5 py-3">
                <Zap className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-300 font-mono leading-snug truncate">{q.query}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-500">{q.dbName}</span>
                    <span className="text-[10px] text-slate-600">·</span>
                    <span className="text-[10px] text-slate-500">{timeAgo(q.executedAt)}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={cn('text-xs font-bold', q.durationMs > 5000 ? 'text-red-400' : q.durationMs > 2000 ? 'text-orange-400' : 'text-yellow-400')}>
                    {q.durationMs >= 1000 ? `${(q.durationMs / 1000).toFixed(1)}s` : `${q.durationMs}ms`}
                  </div>
                  {q.analyzed && <span className="text-[9px] text-emerald-400">AI analyzed</span>}
                </div>
              </div>
            ))}
            {sqList.length === 0 && (
              <div className="px-5 py-8 text-center text-sm text-slate-500">No slow queries captured</div>
            )}
          </div>
        </div>

        {/* Backup Status */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-bold text-white">Backup Status</h2>
              <p className="text-xs text-slate-500">{failedBk > 0 ? `${failedBk} failed` : 'All recent backups OK'}</p>
            </div>
            <Link href="/backups" className="text-xs text-emerald-400 hover:text-emerald-300">View all →</Link>
          </div>
          <div className="divide-y divide-slate-800/60">
            {bkList.slice(0, 5).map((b: { id: string; dbName: string; type: string; status: string; completedAt?: string; scheduledAt: string; sizeMB: number }) => {
              const statusIcon = b.status === 'succeeded' ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                : b.status === 'failed' ? <XCircle className="w-4 h-4 text-red-400" />
                : b.status === 'running' ? <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />
                : <Clock className="w-4 h-4 text-slate-400" />
              return (
                <div key={b.id} className="flex items-center gap-3 px-5 py-3">
                  {statusIcon}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">{b.dbName}</p>
                    <p className="text-[10px] text-slate-500">{b.type} · {b.completedAt ? timeAgo(b.completedAt) : b.status}</p>
                  </div>
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase',
                    b.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-400' :
                    b.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                    b.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                    'bg-slate-700 text-slate-400')}>
                    {b.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { href: '/queries', icon: Zap, label: 'Analyze a Query', color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { href: '/security', icon: Shield, label: 'Security Report', color: 'text-red-400', bg: 'bg-red-500/10' },
          { href: '/capacity', icon: TrendingUp, label: 'Capacity Forecast', color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { href: '/copilot', icon: Activity, label: 'AI Copilot', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
        ].map(item => (
          <Link key={item.href} href={item.href}
            className="rounded-2xl bg-[#0f1629] border border-slate-800 hover:border-slate-700 p-4 flex items-center gap-3 transition-colors group">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', item.bg)}>
              <item.icon className={cn('w-5 h-5', item.color)} />
            </div>
            <span className="text-sm font-medium text-slate-300 group-hover:text-white">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
