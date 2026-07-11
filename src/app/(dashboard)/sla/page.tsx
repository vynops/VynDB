'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Timer, CheckCircle, XCircle, AlertTriangle, Save, Loader2 } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

export default function SlaPage() {
  const { data: incidents } = useSWR('/api/incidents', fetcher, { refreshInterval: 30000 })
  const { data: sla, mutate } = useSWR('/api/sla', fetcher)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<Record<string, { ackMinutes: number; resolveMinutes: number }> | null>(null)

  const currentSla = sla ?? {}
  const editConfig = config ?? currentSla

  const list = Array.isArray(incidents) ? incidents : []

  // Compute SLA achievements
  const slaStats = SEVERITIES.map(sev => {
    const sevIncidents = list.filter((i: { severity: string }) => i.severity === sev)
    const target = currentSla[sev] ?? { ackMinutes: 30, resolveMinutes: 240 }
    let ackBreaches = 0, resolveBreaches = 0, ackMet = 0, resolveMet = 0

    sevIncidents.forEach((inc: { createdAt: string; acknowledgedAt?: string; resolvedAt?: string; status: string }) => {
      const ageMin = (Date.now() - new Date(inc.createdAt).getTime()) / 60000
      if (inc.acknowledgedAt) {
        const ackMin = (new Date(inc.acknowledgedAt).getTime() - new Date(inc.createdAt).getTime()) / 60000
        if (ackMin <= target.ackMinutes) { ackMet++ } else { ackBreaches++ }
      } else if (ageMin > target.ackMinutes && inc.status !== 'resolved') {
        ackBreaches++
      }
      if (inc.resolvedAt) {
        const resolveMin = (new Date(inc.resolvedAt).getTime() - new Date(inc.createdAt).getTime()) / 60000
        if (resolveMin <= target.resolveMinutes) { resolveMet++ } else { resolveBreaches++ }
      }
    })

    const total = sevIncidents.length
    return { sev, total, ackBreaches, resolveBreaches, ackMet, resolveMet, target }
  })

  const handleSave = async () => {
    setSaving(true)
    await fetch('/api/sla', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editConfig),
    })
    mutate()
    setSaving(false)
    setConfig(null)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* SLA overview */}
      <div className="grid sm:grid-cols-4 gap-3">
        {slaStats.map(s => {
          const hasBreaches = s.ackBreaches + s.resolveBreaches > 0
          return (
            <div key={s.sev} className={cn('rounded-2xl border p-4', hasBreaches ? 'bg-red-500/3 border-red-500/20' : 'bg-[#0f1629] border-slate-800')}>
              <div className={cn('text-xs font-bold uppercase mb-2',
                s.sev === 'critical' ? 'text-red-400' : s.sev === 'high' ? 'text-orange-400' : s.sev === 'medium' ? 'text-yellow-400' : 'text-blue-400')}>
                {s.sev}
              </div>
              <div className="flex items-center gap-2 mb-1">
                {hasBreaches ? <XCircle className="w-4 h-4 text-red-400" /> : <CheckCircle className="w-4 h-4 text-emerald-400" />}
                <span className={cn('text-lg font-black', hasBreaches ? 'text-red-400' : 'text-emerald-400')}>
                  {s.total > 0 ? `${Math.round(((s.ackMet + s.resolveMet) / (s.total * 2)) * 100)}%` : 'N/A'}
                </span>
              </div>
              <div className="text-[10px] text-slate-500">{s.total} incidents</div>
              {hasBreaches && <div className="text-[10px] text-red-400 mt-1">{s.ackBreaches} ack · {s.resolveBreaches} resolve breaches</div>}
              <div className="text-[10px] text-slate-600 mt-1">Ack ≤{s.target.ackMinutes}m · Resolve ≤{Math.round(s.target.resolveMinutes / 60 * 10) / 10}h</div>
            </div>
          )
        })}
      </div>

      {/* SLA Config editor */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Timer className="w-4 h-4 text-emerald-400" /> SLA Targets Configuration
          </h3>
          {config && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-xs transition-colors">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
            </button>
          )}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SEVERITIES.map(sev => {
            const t = editConfig[sev] ?? { ackMinutes: 30, resolveMinutes: 240 }
            return (
              <div key={sev} className="p-4 rounded-xl bg-slate-900 border border-slate-700">
                <div className={cn('text-xs font-bold uppercase mb-3',
                  sev === 'critical' ? 'text-red-400' : sev === 'high' ? 'text-orange-400' : sev === 'medium' ? 'text-yellow-400' : 'text-blue-400')}>
                  {sev}
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Ack within (minutes)</label>
                    <input type="number" min="1" value={t.ackMinutes}
                      onChange={e => setConfig(c => ({ ...(c ?? currentSla), [sev]: { ...t, ackMinutes: parseInt(e.target.value) || t.ackMinutes } }))}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Resolve within (minutes)</label>
                    <input type="number" min="1" value={t.resolveMinutes}
                      onChange={e => setConfig(c => ({ ...(c ?? currentSla), [sev]: { ...t, resolveMinutes: parseInt(e.target.value) || t.resolveMinutes } }))}
                      className="w-full px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Recent SLA events */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white">Recent Incident SLA Events</h3>
        </div>
        <div className="divide-y divide-slate-800/60">
          {list.slice(0, 8).map((inc: { id: string; title: string; severity: string; status: string; createdAt: string; acknowledgedAt?: string; resolvedAt?: string }) => {
            const target = currentSla[inc.severity] ?? { ackMinutes: 30, resolveMinutes: 240 }
            const ackMin = inc.acknowledgedAt ? (new Date(inc.acknowledgedAt).getTime() - new Date(inc.createdAt).getTime()) / 60000 : null
            const resolveMin = inc.resolvedAt ? (new Date(inc.resolvedAt).getTime() - new Date(inc.createdAt).getTime()) / 60000 : null
            const ackBreached = ackMin !== null && ackMin > target.ackMinutes
            const resolveBreached = resolveMin !== null && resolveMin > target.resolveMinutes

            return (
              <div key={inc.id} className="flex items-start gap-3 px-5 py-3">
                {(ackBreached || resolveBreached) ? <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" /> : <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-white truncate">{inc.title}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500">
                    <span>{timeAgo(inc.createdAt)}</span>
                    {ackMin !== null && <span className={cn(ackBreached ? 'text-red-400' : 'text-emerald-400')}>Ack: {Math.round(ackMin)}m {ackBreached ? '(BREACH)' : '✓'}</span>}
                    {resolveMin !== null && <span className={cn(resolveBreached ? 'text-red-400' : 'text-emerald-400')}>Resolve: {Math.round(resolveMin / 60 * 10) / 10}h {resolveBreached ? '(BREACH)' : '✓'}</span>}
                  </div>
                </div>
                <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase flex-shrink-0',
                  inc.severity === 'critical' ? 'bg-red-500/20 text-red-400' : inc.severity === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400')}>
                  {inc.severity}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
