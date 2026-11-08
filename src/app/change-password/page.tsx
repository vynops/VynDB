'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle, Loader2, LockKeyhole } from 'lucide-react'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await response.json() as { ok?: boolean; error?: string }
      if (!response.ok) {
        setError(data.error ?? 'Password could not be changed.')
        return
      }
      router.replace('/overview')
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0b0f1a] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-2xl border border-slate-800 bg-[#111827] p-6 space-y-4">
        <div className="flex items-center gap-3">
          <LockKeyhole className="text-emerald-400" size={20} />
          <div>
            <h1 className="text-lg font-bold text-white">Change your password</h1>
            <p className="mt-1 text-xs text-slate-400">Choose a new password to continue.</p>
          </div>
        </div>

        {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"><AlertCircle size={14} />{error}</div>}

        <label className="block text-xs text-slate-400">
          Current password
          <input required autoComplete="current-password" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
        </label>
        <label className="block text-xs text-slate-400">
          New password
          <input required minLength={12} autoComplete="new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
          <span className="mt-1 block text-[11px] text-slate-500">Use at least 12 characters.</span>
        </label>
        <label className="block text-xs text-slate-400">
          Confirm new password
          <input required minLength={12} autoComplete="new-password" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none" />
        </label>

        <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle size={15} />}
          Set new password
        </button>
      </form>
    </main>
  )
}