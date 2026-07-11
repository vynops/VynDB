'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Save, Eye, EyeOff, Loader2, Bell, Brain, Database, Settings as SettingsIcon, Mail, Send, CheckCircle, XCircle, BarChart3, HardDrive } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const TABS = [
  { id: 'ai', label: 'AI Copilot', icon: Brain },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'thresholds', label: 'Thresholds', icon: Database },
  { id: 'general', label: 'General', icon: SettingsIcon },
]

const GROQ_MODELS = [
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile (Recommended)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Fast)' },
  { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (Long context)' },
  { value: 'gemma2-9b-it', label: 'Gemma 2 9B IT' },
  { value: 'llama3-70b-8192', label: 'Llama 3 70B' },
]

export default function SettingsPage() {
  const { data: settings, mutate } = useSWR('/api/settings', fetcher)
  const { data: usage, mutate: refreshUsage } = useSWR('/api/copilot/usage', fetcher, { refreshInterval: 30000 })
  const [form, setForm] = useState<Record<string, unknown> | null>(null)
  const [tab, setTab] = useState('ai')
  const [showKey, setShowKey] = useState(false)
  const [showSmtpPw, setShowSmtpPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  const set = (key: string, value: unknown) => setForm(f => f ? { ...f, [key]: value } : f)
  const g = (key: string) => (form as Record<string, unknown> | null)?.[key]

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    mutate()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const sendTestEmail = async () => {
    setTestStatus('sending')
    setTestMsg('')
    try {
      const res = await fetch('/api/settings/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      })
      const data = await res.json() as { ok: boolean; message: string }
      setTestStatus(data.ok ? 'ok' : 'error')
      setTestMsg(data.message)
    } catch {
      setTestStatus('error')
      setTestMsg('Network error')
    }
  }

  if (!form) return <div className="p-6 text-slate-500">Loading settings…</div>

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">

        {/* Tabs */}
        <div className="flex gap-1 bg-[#0f1629] border border-slate-700 rounded-2xl p-1 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn('flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-colors flex-shrink-0',
                  tab === t.id ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200')}>
                <Icon size={13} /><span className="hidden sm:inline">{t.label}</span>
              </button>
            )
          })}
        </div>

        {/* AI Copilot */}
        {tab === 'ai' && (
          <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Brain className="w-4 h-4 text-violet-400" /> AI Copilot & Query Analyzer</h3>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">Groq API Key</label>
              <div className="relative">
                <input type={showKey ? 'text' : 'password'} value={(g('groqApiKey') as string) ?? ''} onChange={e => set('groqApiKey', e.target.value)}
                  placeholder="gsk_..." className="settings-input pr-10" />
                <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Get free API keys at <a href="https://console.groq.com" target="_blank" className="text-emerald-400 hover:underline">console.groq.com</a></p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">AI Model</label>
              <select value={(g('aiModel') as string) ?? ''} onChange={e => set('aiModel', e.target.value)} className="settings-input">
                {GROQ_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            {/* Token usage stats */}
            <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-400 flex items-center gap-1.5"><BarChart3 size={12} /> Token Usage Stats</h4>
                <button onClick={() => refreshUsage()} className="text-[10px] text-slate-500 hover:text-slate-300">Refresh</button>
              </div>
              {usage ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-black text-emerald-400">{usage.today?.requests ?? 0}</div>
                    <div className="text-[10px] text-slate-500">Requests today</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-black text-violet-400">{((usage.today?.totalTokens ?? 0) / 1000).toFixed(1)}K</div>
                    <div className="text-[10px] text-slate-500">Tokens today</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-black text-blue-400">{((usage.allTime?.totalTokens ?? 0) / 1000).toFixed(0)}K</div>
                    <div className="text-[10px] text-slate-500">All-time tokens</div>
                  </div>
                </div>
              ) : <div className="text-xs text-slate-500">No usage data yet</div>}
              {usage?.last7Days?.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] text-slate-500 mb-2">Last 7 days</div>
                  <div className="space-y-1">
                    {usage.last7Days.map((d: { date: string; requests: number; totalTokens: number; model: string }) => (
                      <div key={d.date + d.model} className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">{d.date}</span>
                        <span className="text-slate-500 capitalize">{d.model.split('-').slice(0, 2).join(' ')}</span>
                        <span className="text-slate-300">{d.requests} req · {(d.totalTokens / 1000).toFixed(1)}K tok</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notifications */}
        {tab === 'notifications' && (
          <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Bell className="w-4 h-4 text-yellow-400" /> Notifications</h3>

            <div>
              <h4 className="text-xs font-bold text-slate-400 mb-3">Slack</h4>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Webhook URL</label>
                <input type="text" value={(g('slackWebhookUrl') as string) ?? ''} onChange={e => set('slackWebhookUrl', e.target.value)}
                  placeholder="https://hooks.slack.com/services/..." className="settings-input" />
              </div>
            </div>

            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2"><Mail size={12} /> Email / SMTP</h4>
              <label className="flex items-center gap-2 text-xs text-slate-400 mb-3 cursor-pointer">
                <input type="checkbox" checked={(g('alertEmailEnabled') as boolean) ?? false} onChange={e => set('alertEmailEnabled', e.target.checked)} className="w-4 h-4 rounded" />
                Enable email alerts
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">SMTP Host</label>
                  <input value={(g('smtpHost') as string) ?? ''} onChange={e => set('smtpHost', e.target.value)} placeholder="smtp.gmail.com" className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Port</label>
                  <input type="number" value={(g('smtpPort') as number) ?? 587} onChange={e => set('smtpPort', parseInt(e.target.value))} className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Username</label>
                  <input value={(g('smtpUser') as string) ?? ''} onChange={e => set('smtpUser', e.target.value)} className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Password</label>
                  <div className="relative">
                    <input type={showSmtpPw ? 'text' : 'password'} value={(g('smtpPassword') as string) ?? ''} onChange={e => set('smtpPassword', e.target.value)} className="settings-input pr-10" />
                    <button onClick={() => setShowSmtpPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                      {showSmtpPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">From Address</label>
                  <input value={(g('smtpFrom') as string) ?? ''} onChange={e => set('smtpFrom', e.target.value)} placeholder="VynDB <alerts@example.com>" className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Alert Recipients</label>
                  <input value={(g('alertRecipients') as string) ?? ''} onChange={e => set('alertRecipients', e.target.value)} placeholder="dba@company.com, ops@company.com" className="settings-input" />
                </div>
              </div>

              {/* Test email */}
              <div className="flex items-center gap-2 mt-3">
                <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send test to..." className="settings-input flex-1" />
                <button onClick={sendTestEmail} disabled={testStatus === 'sending' || !testTo}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-600 hover:border-slate-500 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50">
                  {testStatus === 'sending' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Test
                </button>
              </div>
              {(testStatus === 'ok' || testStatus === 'error') && (
                <div className={cn('flex items-center gap-2 mt-2 p-2.5 rounded-lg text-xs', testStatus === 'ok' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                  {testStatus === 'ok' ? <CheckCircle size={12} /> : <XCircle size={12} />}{testMsg}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Thresholds */}
        {tab === 'thresholds' && (
          <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Database className="w-4 h-4 text-orange-400" /> Alert Thresholds</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { key: 'slowQueryThresholdMs', label: 'Slow query threshold (ms)', type: 'number', hint: 'Queries exceeding this are flagged as slow' },
                { key: 'replicationLagAlertSec', label: 'Replication lag alert (seconds)', type: 'number', hint: 'Alert when replica lags beyond this' },
                { key: 'connectionPoolPctAlert', label: 'Connection pool alert (%)', type: 'number', hint: 'Alert when pool utilisation exceeds this' },
                { key: 'backupRpoBreachAlertHrs', label: 'Backup RPO breach alert (hours)', type: 'number', hint: 'Alert when last backup is older than this' },
              ].map(field => (
                <div key={field.key}>
                  <label className="text-xs font-medium text-slate-400 block mb-1">{field.label}</label>
                  <input type="number" value={(g(field.key) as number) ?? ''} onChange={e => set(field.key, parseFloat(e.target.value))} className="settings-input" />
                  <p className="text-[10px] text-slate-600 mt-0.5">{field.hint}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* General */}
        {tab === 'general' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-slate-400" /> General</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Default Refresh Interval (seconds)</label>
                  <input type="number" value={(g('defaultRefreshInterval') as number) ?? 30} onChange={e => set('defaultRefreshInterval', parseInt(e.target.value))} className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Timezone</label>
                  <select value={(g('timezone') as string) ?? 'UTC'} onChange={e => set('timezone', e.target.value)} className="settings-input">
                    {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo'].map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Backup settings */}
            <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-slate-400" /> Backup Settings
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Retention Period (days)</label>
                  <select value={(g('backupRetentionDays') as number) ?? 7} onChange={e => set('backupRetentionDays', parseInt(e.target.value))} className="settings-input">
                    {[3,7,14,30,60,90].map(d => <option key={d} value={d}>{d} days</option>)}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Auto-cleanup runs daily at 02:05 UTC after nightly backup</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Custom Backup Path (optional)</label>
                  <input value={(g('backupPath') as string) ?? ''} onChange={e => set('backupPath', e.target.value)}
                    placeholder="Leave blank for default (app/backups/)" className="settings-input" />
                  <p className="text-[10px] text-slate-500 mt-1">Absolute path on server. Must be writable by vyndb user.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">RPO Breach Alert (hours)</label>
                  <input type="number" value={(g('backupRpoBreachAlertHrs') as number) ?? 25} onChange={e => set('backupRpoBreachAlertHrs', parseInt(e.target.value))} className="settings-input" />
                  <p className="text-[10px] text-slate-500 mt-1">Alert if last successful backup is older than this</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && (
            <div className="flex items-center gap-2 text-emerald-400 text-xs">
              <CheckCircle size={14} /> Saved!
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
