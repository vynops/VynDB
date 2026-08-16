'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, CheckCircle, Clock, Plus, X, Search, UserPlus, FileText, Loader2 } from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { useAppRefreshInterval } from '@/lib/use-app-refresh-interval'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/30',
  high:     'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  medium:   'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  low:      'bg-blue-500/20 text-blue-400 border border-blue-500/30',
}

const STATUS_BADGE: Record<string, string> = {
  open:         'bg-red-500/10 text-red-400',
  acknowledged: 'bg-yellow-500/10 text-yellow-400',
  resolved:     'bg-emerald-500/10 text-emerald-400',
}

const CAT_COLOR: Record<string, string> = {
  performance:  'text-orange-400',
  availability: 'text-red-400',
  replication:  'text-violet-400',
  backup:       'text-blue-400',
  security:     'text-red-400',
  capacity:     'text-yellow-400',
  other:        'text-slate-400',
}

interface Incident {
  id: string; dbId: string; dbName: string; title: string;
  severity: string; category: string; status: string; source: string;
  createdAt: string; acknowledgedAt?: string; resolvedAt?: string;
  assignedTo?: string; notes?: string; slaBreach?: boolean
}

export default function IncidentsPage() {
  const refreshInterval = useAppRefreshInterval(20)
  const { data: incidents, mutate } = useSWR('/api/incidents', fetcher, { refreshInterval })
  const { data: dbs } = useSWR('/api/databases', fetcher)
  const { data: me } = useSWR('/api/auth/me', fetcher)
  const { data: oncall } = useSWR('/api/oncall', fetcher)

  const list: Incident[] = Array.isArray(incidents) ? incidents : []
  const dbList = Array.isArray(dbs) ? dbs : []
  const shifts = Array.isArray(oncall) ? oncall : []

  const [statusFilter, setStatusFilter] = useState<string>('open+ack')
  const [sevFilter, setSevFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Incident | null>(null)
  const [notes, setNotes] = useState('')
  const [assignTo, setAssignTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ dbId: '', title: '', severity: 'medium', category: 'other', notes: '' })

  const filtered = list.filter(i => {
    const matchStatus = statusFilter === 'all' ? true : statusFilter === 'open+ack' ? ['open', 'acknowledged'].includes(i.status) : i.status === statusFilter
    const matchSev = sevFilter === 'all' || i.severity === sevFilter
    const matchSearch = !search || i.title.toLowerCase().includes(search.toLowerCase()) || i.dbName.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSev && matchSearch
  })

  const open = list.filter(i => i.status === 'open').length
  const ack = list.filter(i => i.status === 'acknowledged').length
  const resolved = list.filter(i => i.status === 'resolved').length

  const updateStatus = async (inc: Incident, newStatus: 'acknowledged' | 'resolved') => {
    setSaving(true)
    const patch: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'acknowledged') patch.acknowledgedAt = new Date().toISOString()
    if (newStatus === 'resolved') { patch.resolvedAt = new Date().toISOString() }
    if (notes.trim()) patch.notes = notes
    if (assignTo) patch.assignedTo = assignTo
    await fetch(`/api/incidents/${inc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    mutate()
    setSaving(false)
    setSelected(null)
    setNotes('')
    setAssignTo('')
  }

  const createIncident = async () => {
    if (!newForm.title) return
    setSaving(true)
    const dbName = dbList.find((d: { id: string }) => d.id === newForm.dbId)?.name ?? 'Unknown'
    await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newForm, dbName, status: 'open', source: 'manual' }),
    })
    mutate()
    setSaving(false)
    setShowNew(false)
    setNewForm({ dbId: '', title: '', severity: 'medium', category: 'other', notes: '' })
  }

  // Get elapsed time since creation for SLA
  const elapsedMin = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 60000)

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4 cursor-pointer" onClick={() => setStatusFilter('open')}>
          <AlertTriangle className="w-5 h-5 text-red-400 mb-2" />
          <div className="text-2xl font-black text-red-400">{open}</div>
          <div className="text-xs text-slate-500">Open</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4 cursor-pointer" onClick={() => setStatusFilter('acknowledged')}>
          <Clock className="w-5 h-5 text-yellow-400 mb-2" />
          <div className="text-2xl font-black text-yellow-400">{ack}</div>
          <div className="text-xs text-slate-500">Acknowledged</div>
        </div>
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4 cursor-pointer" onClick={() => setStatusFilter('resolved')}>
          <CheckCircle className="w-5 h-5 text-emerald-400 mb-2" />
          <div className="text-2xl font-black text-emerald-400">{resolved}</div>
          <div className="text-xs text-slate-500">Resolved</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search incidents..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[['open+ack','Active'], ['open','Open'], ['acknowledged','Ack'], ['resolved','Resolved'], ['all','All']].map(([v, l]) => (
            <button key={v} onClick={() => setStatusFilter(v)}
              className={cn('px-3 py-2 rounded-xl text-xs font-medium transition-colors',
                statusFilter === v ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white border border-slate-700')}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm transition-colors flex-shrink-0">
          <Plus size={14} /> New
        </button>
      </div>

      {/* Incidents list */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="divide-y divide-slate-800/60">
          {filtered.map(inc => {
            const elapsed = elapsedMin(inc.createdAt)
            return (
              <div key={inc.id} className="flex items-start gap-3 p-4 hover:bg-slate-800/20 cursor-pointer transition-colors" onClick={() => { setSelected(inc); setNotes(inc.notes ?? ''); setAssignTo(inc.assignedTo ?? '') }}>
                <AlertTriangle className={cn('w-4 h-4 flex-shrink-0 mt-0.5',
                  inc.severity === 'critical' ? 'text-red-400' : inc.severity === 'high' ? 'text-orange-400' : inc.severity === 'medium' ? 'text-yellow-400' : 'text-blue-400')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-sm font-semibold text-white leading-snug">{inc.title}</span>
                    {inc.slaBreach && <span className="text-[9px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">SLA BREACH</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                    <span>{inc.dbName}</span>
                    <span>·</span>
                    <span className={cn('capitalize', CAT_COLOR[inc.category])}>{inc.category}</span>
                    <span>·</span>
                    <span>{timeAgo(inc.createdAt)}</span>
                    {inc.assignedTo && <><span>·</span><span className="text-emerald-400">→ {inc.assignedTo.split('@')[0]}</span></>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', SEV_BADGE[inc.severity])}>{inc.severity}</span>
                  <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', STATUS_BADGE[inc.status])}>{inc.status}</span>
                  <span className="text-[9px] text-slate-600">{elapsed}m</span>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="p-10 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No incidents found</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <div className="flex items-center gap-2">
                <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', SEV_BADGE[selected.severity])}>{selected.severity}</span>
                <span className="text-sm font-bold text-white truncate">{selected.dbName}</span>
              </div>
              <button onClick={() => setSelected(null)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white">{selected.title}</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Status</div><div className={cn('font-bold capitalize', STATUS_BADGE[selected.status].split(' ')[1])}>{selected.status}</div></div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Category</div><div className={cn('font-bold capitalize', CAT_COLOR[selected.category])}>{selected.category}</div></div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Created</div><div className="text-white">{timeAgo(selected.createdAt)}</div></div>
                {selected.acknowledgedAt && <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Acknowledged</div><div className="text-white">{timeAgo(selected.acknowledgedAt)}</div></div>}
                {selected.resolvedAt && <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700"><div className="text-slate-500 mb-0.5">Resolved</div><div className="text-white">{timeAgo(selected.resolvedAt)}</div></div>}
                {selected.assignedTo && <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700 col-span-2"><div className="text-slate-500 mb-0.5">Assigned to</div><div className="text-emerald-400">{selected.assignedTo}</div></div>}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Assign to (email)</label>
                <input value={assignTo} onChange={e => setAssignTo(e.target.value)} placeholder={me?.email ?? 'user@example.com'}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500/60" />
                {shifts.length > 0 && (
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {shifts.slice(0, 3).map((s: { id: string; userEmail: string; userName: string }) => (
                      <button key={s.id} onClick={() => setAssignTo(s.userEmail)}
                        className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-lg hover:border-emerald-500/40">
                        {s.userName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes, RCA, actions taken..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500/60 resize-none" />
              </div>

              {selected.status !== 'resolved' && (
                <div className="flex gap-2">
                  {selected.status === 'open' && (
                    <button onClick={() => updateStatus(selected, 'acknowledged')} disabled={saving}
                      className="flex-1 py-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 font-semibold text-xs transition-colors">
                      {saving ? <Loader2 size={12} className="animate-spin mx-auto" /> : 'Acknowledge'}
                    </button>
                  )}
                  <button onClick={() => updateStatus(selected, 'resolved')} disabled={saving}
                    className="flex-1 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-xs transition-colors">
                    {saving ? <Loader2 size={12} className="animate-spin mx-auto" /> : 'Mark Resolved'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New incident modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">Create Incident</h2>
              <button onClick={() => setShowNew(false)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Title *</label>
                <input value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} placeholder="Describe the issue" className="settings-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Database</label>
                  <select value={newForm.dbId} onChange={e => setNewForm(f => ({ ...f, dbId: e.target.value }))} className="settings-input">
                    <option value="">Select DB</option>
                    {dbList.map((d: { id: string; name: string }) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Severity</label>
                  <select value={newForm.severity} onChange={e => setNewForm(f => ({ ...f, severity: e.target.value }))} className="settings-input">
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Category</label>
                  <select value={newForm.category} onChange={e => setNewForm(f => ({ ...f, category: e.target.value }))} className="settings-input">
                    {['performance', 'availability', 'replication', 'backup', 'security', 'capacity', 'other'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Notes</label>
                  <textarea value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="settings-input resize-none" />
                </div>
              </div>
              <button onClick={createIncident} disabled={saving || !newForm.title}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 size={13} className="animate-spin" />}
                Create Incident
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
