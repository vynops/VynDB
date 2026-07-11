'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Database, AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Login failed')
      } else {
        router.push('/overview')
        router.refresh()
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 mb-4">
            <Database size={22} className="text-emerald-400" />
          </div>
          <h1 className="text-xl font-black text-white">
            Vyn<span className="text-emerald-400">DB</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">Database Operations Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">Email</label>
            <input
              type="email" autoComplete="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="admin@vyndb.local"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password" required value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 pr-10 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20"
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Signing in…</> : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 p-3 rounded-xl bg-slate-900/50 border border-slate-800">
          <p className="text-xs text-slate-500 text-center font-medium mb-1">Demo credentials</p>
          <p className="text-xs text-slate-400 text-center">admin@vyndb.local / admin123</p>
        </div>
      </div>
    </div>
  )
}
