'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Phone, Plus, Trash2, Clock, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppTimezone, formatAppDate } from '@/lib/use-app-timezone'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Shift {
  id: string; name: string; userEmail: string; userName: string;
  startTime: string; endTime: string; timezone: string
}

const TZONES = ['UTC', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney']

export default function OnCallPage() {
  const appTimezone = useAppTimezone()
  const { data: shifts, mutate } = useSWR('/api/oncall', fetcher)
  const list: Shift[] = Array.isArray(shifts) ? shifts : []

  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', userEmail: '', userName: '', startTime: '', endTime: '', timezone: 'UTC' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const now = new Date()
  const active = list.filter(s => new Date(s.startTime) <= now && new Date(s.endTime) > now)
  const upcoming = list.filter(s => new Date(s.startTime) > now).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  const past = list.filter(s => new Date(s.endTime) <= now).sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())

  const handleSave = async () => {
    if (!form.userEmail || !form.startTime || !form.endTime) return
    setSaving(true)
    await fetch('/api/oncall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    mutate()
    setSaving(false)
    setShowModal(false)
    setForm({ name: '', userEmail: '', userName: '', startTime: '', endTime: '', timezone: 'UTC' })
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    await fetch(`/api/oncall/${id}`, { method: 'DELETE' })
    mutate()
    setDeleting(null)
  }

  const ShiftCard = ({ shift, badge }: { shift: Shift; badge?: string }) => (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-900/60 border border-slate-700">
      <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
        <span className="text-emerald-400 text-sm font-black">{shift.userName?.charAt(0)?.toUpperCase() || shift.userEmail?.charAt(0)?.toUpperCase() || '?'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{shift.userName || shift.userEmail.split('@')[0]}</span>
          {badge && <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full uppercase', badge === 'ACTIVE' ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300')}>{badge}</span>}
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">{shift.userEmail}</div>
        <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-2">
          <span className="flex items-center gap-1"><Clock size={9} />{formatAppDate(shift.startTime, appTimezone, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span>→</span>
          <span>{formatAppDate(shift.endTime, appTimezone, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-slate-600">({appTimezone})</span>
        </div>
        {shift.name && <div className="text-[10px] text-emerald-400/70 mt-0.5">{shift.name}</div>}
      </div>
      <button onClick={() => handleDelete(shift.id)} disabled={deleting === shift.id}
        className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 flex-shrink-0">
        {deleting === shift.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      </button>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Current on-call */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Phone className="w-4 h-4 text-emerald-400" /> Current On-Call
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Who to page right now</p>
          </div>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-xs transition-colors">
            <Plus size={13} /> Add Shift
          </button>
        </div>
        {active.length > 0 ? (
          <div className="space-y-2">
            {active.map(s => <ShiftCard key={s.id} shift={s} badge="ACTIVE" />)}
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 text-sm">
            <Phone className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No one is on-call right now
          </div>
        )}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-white mb-3">Upcoming Shifts</h3>
          <div className="space-y-2">
            {upcoming.slice(0, 5).map(s => <ShiftCard key={s.id} shift={s} badge="UPCOMING" />)}
          </div>
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5">
          <h3 className="text-sm font-bold text-slate-400 mb-3">Past Shifts</h3>
          <div className="space-y-2 opacity-60">
            {past.slice(0, 3).map(s => <ShiftCard key={s.id} shift={s} />)}
          </div>
        </div>
      )}

      {/* Add shift modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">Add On-Call Shift</h2>
              <button onClick={() => setShowModal(false)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Shift Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Primary On-Call" className="settings-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Name</label>
                  <input value={form.userName} onChange={e => setForm(f => ({ ...f, userName: e.target.value }))} placeholder="Jane Doe" className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Email *</label>
                  <input type="email" value={form.userEmail} onChange={e => setForm(f => ({ ...f, userEmail: e.target.value }))} placeholder="jane@example.com" className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Start *</label>
                  <input type="datetime-local" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: new Date(e.target.value).toISOString() }))} className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">End *</label>
                  <input type="datetime-local" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: new Date(e.target.value).toISOString() }))} className="settings-input" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-400 block mb-1">Timezone</label>
                  <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} className="settings-input">
                    {TZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
              </div>
              <button onClick={handleSave} disabled={saving || !form.userEmail || !form.startTime || !form.endTime}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 size={13} className="animate-spin" />} Save Shift
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
