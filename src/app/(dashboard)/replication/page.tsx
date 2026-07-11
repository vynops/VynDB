'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { GitBranch, AlertTriangle, CheckCircle, Clock, Activity, X, Copy, Check } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const ROLE_COLOR: Record<string, string> = {
  primary:  'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  replica:  'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  standby:  'bg-violet-500/20 text-violet-400 border border-violet-500/30',
  unknown:  'bg-slate-700 text-slate-400',
}

const STATUS_COLOR: Record<string, string> = {
  healthy:  'text-emerald-400',
  warning:  'text-yellow-400',
  critical: 'text-red-400',
}

type ReplNode = { dbId: string; dbName: string; engine: string; role: string; lagSeconds: number; lagBytes?: number; syncState?: string; connectedReplicas?: number; lastSyncAt: string; status: string }

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 flex-shrink-0 transition-colors">
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

export default function ReplicationPage() {
  const { data: replication } = useSWR('/api/replication', fetcher, { refreshInterval: 15000 })
  const list = Array.isArray(replication) ? replication as ReplNode[] : []
  const [selected, setSelected] = useState<ReplNode | null>(null)

  const healthy = list.filter((r: { status: string }) => r.status === 'healthy').length
  const warning = list.filter((r: { status: string }) => r.status === 'warning').length
  const critical = list.filter((r: { status: string }) => r.status === 'critical').length

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
          <CheckCircle className="w-5 h-5 text-emerald-400 mb-2" />
          <div className="text-xl font-black text-emerald-400">{healthy}</div>
          <div className="text-xs text-slate-500">Healthy</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
          <AlertTriangle className="w-5 h-5 text-yellow-400 mb-2" />
          <div className="text-xl font-black text-yellow-400">{warning}</div>
          <div className="text-xs text-slate-500">Warning</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
          <Activity className="w-5 h-5 text-red-400 mb-2" />
          <div className="text-xl font-black text-red-400">{critical}</div>
          <div className="text-xs text-slate-500">Critical</div>
        </div>
      </div>

      {/* Replication table */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white">Replication Status</h2>
          <p className="text-xs text-slate-500">{list.length} nodes monitored</p>
        </div>
        <div className="divide-y divide-slate-800/60">
          {list.map((r) => (
            <div key={r.dbId} onClick={() => setSelected(r)}
              className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-800/30 transition-colors">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', r.status === 'healthy' ? 'bg-emerald-500' : r.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500')} />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{r.dbName}</span>
                    <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', ROLE_COLOR[r.role])}>{r.role}</span>
                    <span className="text-[10px] text-slate-500 capitalize">{r.engine}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {r.syncState && <span className="text-[10px] text-slate-400">State: <span className="text-blue-400">{r.syncState}</span></span>}
                    {r.connectedReplicas !== undefined && <span className="text-[10px] text-slate-400">{r.connectedReplicas} replica(s)</span>}
                    <span className="text-[10px] text-slate-500">Synced {timeAgo(r.lastSyncAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:flex-shrink-0">
                <div className="text-right">
                  <div className="text-xs text-slate-500">Lag</div>
                  <div className={cn('text-sm font-black', STATUS_COLOR[r.status])}>
                    {r.role === 'primary' ? '—' : r.lagSeconds < 1 ? `${Math.round(r.lagSeconds * 1000)}ms` : `${r.lagSeconds.toFixed(1)}s`}
                  </div>
                </div>
                {r.lagBytes !== undefined && (
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Lag bytes</div>
                    <div className="text-sm font-bold text-slate-300">{r.lagBytes >= 1048576 ? `${(r.lagBytes / 1048576).toFixed(1)}M` : r.lagBytes >= 1024 ? `${(r.lagBytes / 1024).toFixed(0)}K` : `${r.lagBytes}B`}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {list.length === 0 && (
            <div className="p-10 text-center text-slate-500">
              <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No replication nodes configured
            </div>
          )}
        </div>
      </div>

      {/* Guidance */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { engine: 'PostgreSQL', tips: ['Monitor pg_stat_replication for lag', 'Set wal_keep_size to prevent WAL removal', 'Use synchronous_commit=remote_apply for zero-lag RPO'] },
          { engine: 'MySQL/MariaDB', tips: ['Check SHOW SLAVE STATUS\\G for lag', 'Use GTID replication for easier failover', 'Enable parallel replication (slave_parallel_workers)'] },
          { engine: 'Oracle Data Guard', tips: ['Monitor V$DATAGUARD_STATS for lag', 'Use Maximum Availability protection mode', 'Test switchover regularly (once/quarter)'] },
        ].map(g => (
          <div key={g.engine} className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
            <h4 className="text-xs font-bold text-slate-300 mb-2">{g.engine}</h4>
            <ul className="space-y-1.5">
              {g.tips.map(t => (
                <li key={t} className="flex items-start gap-2 text-xs text-slate-400">
                  <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Detail Modal */}
      {selected && (() => {
        const r = selected
        const lagPct = r.role === 'primary' ? 0 : Math.min(100, (r.lagSeconds / 60) * 100)
        const lagColor = r.status === 'healthy' ? 'bg-emerald-500' : r.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
        const lagLabel = r.role === 'primary' ? '—' : r.lagSeconds < 1 ? `${Math.round(r.lagSeconds * 1000)}ms` : `${r.lagSeconds.toFixed(2)}s`
        const sqlCommands: Record<string, { label: string; sql: string }[]> = {
          postgresql: r.role === 'primary' ? [
            { label: 'Replication slots', sql: "SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS lag FROM pg_replication_slots;" },
            { label: 'Connected standbys', sql: "SELECT client_addr, state, sync_state, write_lag, flush_lag, replay_lag FROM pg_stat_replication;" },
          ] : [
            { label: 'Replica status', sql: "SELECT status, received_lsn, latest_end_lsn, pg_size_pretty(pg_wal_lsn_diff(latest_end_lsn, received_lsn)) AS lag FROM pg_stat_wal_receiver;" },
            { label: 'Recovery state', sql: "SELECT pg_is_in_recovery(), pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn(), now() - pg_last_xact_replay_timestamp() AS lag;" },
          ],
          mysql: [
            { label: 'Replica status', sql: "SHOW REPLICA STATUS\\G" },
            { label: 'Binary log position', sql: "SHOW MASTER STATUS;" },
          ],
          mongodb: [
            { label: 'Replica set status', sql: "rs.status()" },
            { label: 'Replication lag', sql: "rs.printSecondaryReplicationInfo()" },
          ],
        }
        const cmds = sqlCommands[r.engine] ?? []
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelected(null)}>
            <div className="bg-[#0f1629] border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className={cn('w-2.5 h-2.5 rounded-full', r.status === 'healthy' ? 'bg-emerald-500' : r.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500')} />
                  <span className="text-sm font-bold text-white">{r.dbName}</span>
                  <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', ROLE_COLOR[r.role])}>{r.role}</span>
                  <span className="text-[10px] text-slate-500 capitalize">{r.engine}</span>
                </div>
                <button onClick={() => setSelected(null)}><X size={14} className="text-slate-400 hover:text-white" /></button>
              </div>
              <div className="p-5 space-y-4 text-xs">
                {/* Lag meter */}
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-400 font-medium">Replication Lag</span>
                    <span className={cn('font-black text-sm', STATUS_COLOR[r.status])}>{lagLabel}</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', lagColor)} style={{ width: `${Math.max(lagPct, r.role === 'primary' ? 0 : 2)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-[10px] text-slate-600">
                    <span>0s (ideal)</span><span>30s (warn)</span><span>60s+ (critical)</span>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">Status</div>
                    <div className={cn('font-bold capitalize', STATUS_COLOR[r.status])}>{r.status}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">Role</div>
                    <div className="font-bold text-white capitalize">{r.role}</div>
                  </div>
                  {r.syncState && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-slate-500 mb-1">Sync State</div>
                      <div className="font-bold text-blue-400">{r.syncState}</div>
                    </div>
                  )}
                  {r.connectedReplicas !== undefined && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-slate-500 mb-1">Connected Replicas</div>
                      <div className="font-bold text-white">{r.connectedReplicas}</div>
                    </div>
                  )}
                  {r.lagBytes !== undefined && (
                    <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="text-slate-500 mb-1">Lag (bytes)</div>
                      <div className="font-bold text-white">
                        {r.lagBytes >= 1048576 ? `${(r.lagBytes/1048576).toFixed(1)}MB` : r.lagBytes >= 1024 ? `${(r.lagBytes/1024).toFixed(0)}KB` : `${r.lagBytes}B`}
                      </div>
                    </div>
                  )}
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="text-slate-500 mb-1">Last Synced</div>
                    <div className="font-bold text-white">{timeAgo(r.lastSyncAt)}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{new Date(r.lastSyncAt).toLocaleString()}</div>
                  </div>
                </div>

                {/* Quick SQL */}
                {cmds.length > 0 && (
                  <div>
                    <div className="text-slate-400 font-bold mb-2 uppercase tracking-wide text-[10px]">Quick Check Commands</div>
                    <div className="space-y-2">
                      {cmds.map(c => (
                        <div key={c.label} className="rounded-xl bg-slate-900 border border-slate-700 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-500">{c.label}</span>
                            <CopyBtn text={c.sql} />
                          </div>
                          <code className="text-[10px] text-slate-300 font-mono break-all">{c.sql}</code>
                        </div>
                      ))}
                    </div>
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
