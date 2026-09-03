'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Users, Plus, Edit2, Trash2, X, Loader2, Eye, EyeOff, Power } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const ROLE_COLOR: Record<string, string> = {
  admin:  'bg-red-500/20 text-red-400 border border-red-500/30',
  editor: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  viewer: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
}

const ROLE_DESC: Record<string, string> = {
  admin:  'Full access: manage databases, settings, users, incidents',
  editor: 'Can acknowledge/resolve incidents, add databases, analyze queries',
  viewer: 'Read-only: view all data, cannot make changes',
}

interface User { id: string; email: string; name: string; role: string; active: boolean; createdAt: string; lastLogin?: string }

export default function TeamPage() {
  const { data: users, mutate } = useSWR('/api/team', fetcher)
  const { data: me } = useSWR('/api/auth/me', fetcher)
  const list: User[] = Array.isArray(users) ? users : []

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: 'viewer', password: '' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)

  const openAdd = () => { setEditId(null); setForm({ name: '', email: '', role: 'viewer', password: '' }); setShowPassword(false); setShowModal(true) }
  const openEdit = (u: User) => { setEditId(u.id); setForm({ name: u.name, email: u.email, role: u.role, password: '' }); setShowPassword(false); setShowModal(true) }

  const handleSave = async () => {
    setSaving(true)
    if (editId) {
      await fetch(`/api/team/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, role: form.role, password: form.password || undefined }),
      })
    } else {
      await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
    }
    mutate()
    setSaving(false)
    setShowModal(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user?')) return
    setDeleting(id)
    await fetch(`/api/team/${id}`, { method: 'DELETE' })
    mutate()
    setDeleting(null)
  }

  const handleStatusChange = async (user: User) => {
    setUpdatingStatus(user.id)
    await fetch(`/api/team/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active }),
    })
    mutate()
    setUpdatingStatus(null)
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Role permissions */}
      <div className="grid sm:grid-cols-3 gap-3">
        {Object.entries(ROLE_DESC).map(([role, desc]) => (
          <div key={role} className="rounded-2xl bg-[#0f1629] border border-slate-800 p-4">
            <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase', ROLE_COLOR[role])}>{role}</span>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2"><Users className="w-4 h-4 text-emerald-400" /> Team Members</h2>
            <p className="text-xs text-slate-500">{list.length} users</p>
          </div>
          {me?.role === 'admin' && (
            <button onClick={openAdd}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-xs transition-colors">
              <Plus size={13} /> Add User
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-800/60">
          {list.map(user => (
            <div key={user.id} className="flex items-center gap-3 px-5 py-4">
              <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                <span className="text-emerald-400 text-sm font-black">{user.name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white">{user.name}</span>
                  {user.id === me?.id && <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full">You</span>}
                </div>
                <div className="text-xs text-slate-400">{user.email}</div>
                {user.lastLogin && <div className="text-[10px] text-slate-600">Last login: {new Date(user.lastLogin).toLocaleDateString()}</div>}
              </div>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase flex-shrink-0', ROLE_COLOR[user.role])}>{user.role}</span>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full uppercase flex-shrink-0', user.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-400')}>{user.active ? 'Active' : 'Inactive'}</span>
              {me?.role === 'admin' && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(user)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300">
                    <Edit2 size={13} />
                  </button>
                  {user.role !== 'admin' && (
                    <button onClick={() => handleStatusChange(user)} disabled={updatingStatus === user.id} title={user.active ? 'Deactivate user' : 'Activate user'} aria-label={user.active ? `Deactivate ${user.name}` : `Activate ${user.name}`} className={cn('p-1.5 rounded-lg text-slate-500', user.active ? 'hover:bg-amber-500/10 hover:text-amber-400' : 'hover:bg-emerald-500/10 hover:text-emerald-400')}>
                      {updatingStatus === user.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                    </button>
                  )}
                  {user.id !== me?.id && (
                    <button onClick={() => handleDelete(user.id)} disabled={deleting === user.id} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400">
                      {deleting === user.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add/edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">{editId ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setShowModal(false)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Full Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="settings-input" />
              </div>
              {!editId && (
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="settings-input" />
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Role</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="settings-input">
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">{editId ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                <div className="relative">
                  <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="settings-input pr-10" />
                  <button type="button" onClick={() => setShowPassword(value => !value)} title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <button onClick={handleSave} disabled={saving || !form.name || (!editId && (!form.email || !form.password))}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 size={13} className="animate-spin" />}
                {editId ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
