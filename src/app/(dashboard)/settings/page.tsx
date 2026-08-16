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

const AI_PROVIDERS = [
  {
    id: 'groq',
    label: 'Groq (Recommended)',
    keyLabel: 'Groq API Key',
    keyPlaceholder: 'gsk_...',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant (Fast)' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (Long context)' },
      { value: 'gemma2-9b-it', label: 'Gemma 2 9B IT' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyLabel: 'OpenAI API Key',
    keyPlaceholder: 'sk-...',
    defaultModel: 'gpt-4o-mini',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    keyLabel: 'Claude API Key',
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-3-5-sonnet-latest',
    models: [
      { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { value: 'claude-3-opus-latest', label: 'Claude 3 Opus' },
      { value: 'claude-3-haiku-latest', label: 'Claude 3 Haiku (Fast)' },
    ],
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    keyLabel: 'Gemini API Key',
    keyPlaceholder: 'AIza...',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom / Self-Hosted',
    keyLabel: 'API Key',
    keyPlaceholder: 'your-api-key',
    defaultModel: 'your-model-id',
    models: [],
  },
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
  const [testingAi, setTestingAi] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testingChannel, setTestingChannel] = useState<string | null>(null)
  const [channelTestResults, setChannelTestResults] = useState<Record<string, { ok: boolean; msg: string; timestamp: string }>>({})

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  const set = (key: string, value: unknown) => setForm(f => f ? { ...f, [key]: value } : f)
  const g = (key: string) => (form as Record<string, unknown> | null)?.[key]

  const handleSave = async () => {
    if (!form) return
    setSaving(true)
    const response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string }
      setSaved(false)
      setSaving(false)
      window.alert(data.error ?? 'Settings could not be saved')
      return
    }
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

  const testAiConnection = async () => {
    setTestingAi(true)
    setAiTestResult(null)
    try {
      const provider = g('aiProvider') as string
      const apiKey = g('aiApiKey') as string
      const model = g('aiModel') as string
      const baseUrl = g('aiBaseUrl') as string
      
      const res = await fetch('/api/copilot/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, model, baseUrl }),
      })
      const data = await res.json()
      setAiTestResult({
        ok: res.ok && data.ok,
        msg: data.message || (res.ok ? 'Connected' : 'Failed to connect'),
      })
    } catch (e) {
      setAiTestResult({
        ok: false,
        msg: `Error: ${(e as Error).message}`,
      })
    } finally {
      setTestingAi(false)
    }
  }

  const testNotificationChannel = async (channelId: string) => {
    const url = g(channelId) as string
    if (!url) {
      setChannelTestResults(prev => ({ ...prev, [channelId]: { ok: false, msg: 'URL not configured', timestamp: new Date().toLocaleTimeString() } }))
      return
    }
    setTestingChannel(channelId)
    try {
      const res = await fetch('/api/settings/test-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelId, url }),
      })
      const data = await res.json() as { ok: boolean; message: string }
      setChannelTestResults(prev => ({
        ...prev,
        [channelId]: { ok: data.ok, msg: data.message, timestamp: new Date().toLocaleTimeString() }
      }))
    } catch (e) {
      setChannelTestResults(prev => ({
        ...prev,
        [channelId]: { ok: false, msg: `Error: ${e instanceof Error ? e.message : String(e)}`, timestamp: new Date().toLocaleTimeString() }
      }))
    } finally {
      setTestingChannel(null)
    }
  }

  if (!form) return <div className="p-6 text-slate-500">Loading settings…</div>

  const currentProvider = AI_PROVIDERS.find(p => p.id === g('aiProvider')) || AI_PROVIDERS[0]
  const availableModels = currentProvider.models.length > 0 ? currentProvider.models : [
    { value: g('aiModel') as string, label: `${g('aiModel')} (custom)` },
  ]

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
            
            {/* Provider selector */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">AI Provider</label>
              <select value={(g('aiProvider') as string) ?? 'groq'} onChange={e => {
                const newProvider = AI_PROVIDERS.find(p => p.id === e.target.value) || AI_PROVIDERS[0]
                set('aiProvider', newProvider.id)
                set('aiModel', newProvider.defaultModel)
                set('aiApiKey', '')
                setAiTestResult(null)
              }} className="settings-input">
                {AI_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>

            {/* API Key */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">{currentProvider.keyLabel}</label>
              <div className="relative">
                <input type={showKey ? 'text' : 'password'} value={(g('aiApiKey') as string) ?? ''} onChange={e => set('aiApiKey', e.target.value)}
                  placeholder={currentProvider.keyPlaceholder} className="settings-input pr-10" />
                <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {currentProvider.id === 'groq' && (
                <p className="text-[10px] text-slate-500 mt-1">Get free API keys at <a href="https://console.groq.com" target="_blank" className="text-emerald-400 hover:underline">console.groq.com</a></p>
              )}
              {currentProvider.id === 'openai' && (
                <p className="text-[10px] text-slate-500 mt-1">Get your API key from <a href="https://platform.openai.com" target="_blank" className="text-emerald-400 hover:underline">platform.openai.com</a></p>
              )}
              {currentProvider.id === 'anthropic' && (
                <p className="text-[10px] text-slate-500 mt-1">Get your API key from <a href="https://console.anthropic.com" target="_blank" className="text-emerald-400 hover:underline">console.anthropic.com</a></p>
              )}
              {currentProvider.id === 'google' && (
                <p className="text-[10px] text-slate-500 mt-1">Get your API key from <a href="https://aistudio.google.com" target="_blank" className="text-emerald-400 hover:underline">Google AI Studio</a></p>
              )}
              {currentProvider.id === 'custom' && (
                <p className="text-[10px] text-slate-500 mt-1">Configure your self-hosted or proxy endpoint below</p>
              )}
            </div>

            {/* Model selector */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">AI Model</label>
              {availableModels.length > 0 ? (
                <select value={(g('aiModel') as string) ?? currentProvider.defaultModel} onChange={e => set('aiModel', e.target.value)} className="settings-input">
                  {availableModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              ) : (
                <input type="text" value={(g('aiModel') as string) ?? ''} onChange={e => set('aiModel', e.target.value)}
                  placeholder={currentProvider.defaultModel} className="settings-input font-mono text-xs" />
              )}
              {currentProvider.id !== 'custom' && (
                <p className="text-[10px] text-slate-500 mt-1">Select a model available in your {currentProvider.label} account.</p>
              )}
            </div>

            {/* Custom base URL for self-hosted */}
            {currentProvider.id === 'custom' && (
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">OpenAI-Compatible Base URL</label>
                <input type="text" value={(g('aiBaseUrl') as string) ?? ''} onChange={e => set('aiBaseUrl', e.target.value)}
                  placeholder="https://api.example.com/v1" className="settings-input font-mono text-xs" />
                <p className="text-[10px] text-slate-500 mt-1">The endpoint must expose an OpenAI-compatible API.</p>
              </div>
            )}

            {/* Test AI Connection */}
            <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-white">Test Connection</p>
                <button onClick={testAiConnection} disabled={testingAi || !(g('aiApiKey'))}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-xs transition-colors">
                  {testingAi ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                  Test
                </button>
              </div>
              {aiTestResult && (
                <div className={cn('text-xs p-2.5 rounded-lg font-mono', aiTestResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                  {aiTestResult.msg}
                </div>
              )}
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

            {/* Slack */}
            <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-300">Slack</h4>
                <button onClick={() => testNotificationChannel('slackWebhookUrl')} disabled={testingChannel === 'slackWebhookUrl' || !(g('slackWebhookUrl'))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs font-medium transition-colors">
                  {testingChannel === 'slackWebhookUrl' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />} Test
                </button>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Webhook URL</label>
                <input type="text" value={(g('slackWebhookUrl') as string) ?? ''} onChange={e => set('slackWebhookUrl', e.target.value)}
                  placeholder="https://hooks.slack.com/services/..." className="settings-input" />
              </div>
              {channelTestResults['slackWebhookUrl'] && (
                <div className={cn('mt-2 p-2.5 rounded-lg text-xs font-mono', 
                  channelTestResults['slackWebhookUrl'].ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                  {channelTestResults['slackWebhookUrl'].msg}
                </div>
              )}
            </div>

            {/* Microsoft Teams */}
            <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-300">Microsoft Teams</h4>
                <button onClick={() => testNotificationChannel('teamsWebhookUrl')} disabled={testingChannel === 'teamsWebhookUrl' || !(g('teamsWebhookUrl'))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs font-medium transition-colors">
                  {testingChannel === 'teamsWebhookUrl' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />} Test
                </button>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Webhook URL</label>
                <input type="text" value={(g('teamsWebhookUrl') as string) ?? ''} onChange={e => set('teamsWebhookUrl', e.target.value)}
                  placeholder="https://outlook.webhook.office.com/webhookb2/..." className="settings-input" />
                <p className="text-[10px] text-slate-500 mt-1">Get from Teams → Apps & integrations → Webhooks</p>
              </div>
              {channelTestResults['teamsWebhookUrl'] && (
                <div className={cn('mt-2 p-2.5 rounded-lg text-xs font-mono', 
                  channelTestResults['teamsWebhookUrl'].ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                  {channelTestResults['teamsWebhookUrl'].msg}
                </div>
              )}
            </div>

            {/* Custom Webhook */}
            <div className="rounded-xl bg-slate-900 border border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-bold text-slate-300">Custom Webhook URL</h4>
                <button onClick={() => testNotificationChannel('customWebhookUrl')} disabled={testingChannel === 'customWebhookUrl' || !(g('customWebhookUrl'))}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-xs font-medium transition-colors">
                  {testingChannel === 'customWebhookUrl' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />} Test
                </button>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">URL</label>
                <input type="text" value={(g('customWebhookUrl') as string) ?? ''} onChange={e => set('customWebhookUrl', e.target.value)}
                  placeholder="https://your-webhook-endpoint.com/alerts" className="settings-input" />
                <p className="text-[10px] text-slate-500 mt-1">Sends JSON POST request with incident details</p>
              </div>
              {channelTestResults['customWebhookUrl'] && (
                <div className={cn('mt-2 p-2.5 rounded-lg text-xs font-mono', 
                  channelTestResults['customWebhookUrl'].ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')}>
                  {channelTestResults['customWebhookUrl'].msg}
                </div>
              )}
            </div>

            {/* Email / SMTP */}
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

            {/* Team Assignment */}
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-xs font-bold text-slate-400 mb-3">Team / On-Call Group</h4>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Notify Team</label>
                <input type="text" value={(g('notificationTeam') as string) ?? ''} onChange={e => set('notificationTeam', e.target.value)}
                  placeholder="Team name or group ID (e.g., 'SRE Team', '@platform-ops')" className="settings-input" />
                <p className="text-[10px] text-slate-500 mt-1">Incidents will be tagged with this team for routing and on-call escalation</p>
              </div>
              <div className="mt-3 max-w-xs">
                <label className="text-xs font-medium text-slate-400 block mb-1">Duplicate notification cooldown (minutes)</label>
                <input type="number" min={0} max={1440} value={(g('notifyCooldownMinutes') as number) ?? 30}
                  onChange={e => set('notifyCooldownMinutes', e.target.value === '' ? '' : parseInt(e.target.value, 10))} className="settings-input" />
                <p className="text-[10px] text-slate-500 mt-1">Use 0 to disable duplicate suppression.</p>
              </div>
            </div>
          </div>
        )}

        {/* Thresholds */}
        {tab === 'thresholds' && (
          <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Database className="w-4 h-4 text-orange-400" /> Alert Thresholds</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { key: 'slowQueryThresholdMs', label: 'Slow query threshold (ms)', min: 1, max: 86400000, hint: 'Queries exceeding this are flagged as slow' },
                { key: 'replicationLagAlertSec', label: 'Replication lag alert (seconds)', min: 1, max: 86400, hint: 'Alert when replica lags beyond this' },
                { key: 'connectionPoolPctAlert', label: 'Connection pool alert (%)', min: 1, max: 100, hint: 'Alert when pool utilisation exceeds this' },
                { key: 'backupRpoBreachAlertHrs', label: 'Backup RPO breach alert (hours)', min: 1, max: 8760, hint: 'Alert when last backup is older than this' },
              ].map(field => (
                <div key={field.key}>
                  <label className="text-xs font-medium text-slate-400 block mb-1">{field.label}</label>
                  <input type="number" min={field.min} max={field.max} value={(g(field.key) as number) ?? ''} onChange={e => set(field.key, e.target.value === '' ? '' : parseFloat(e.target.value))} className="settings-input" />
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
                  <input type="number" min={5} max={3600} value={(g('defaultRefreshInterval') as number) ?? 30} onChange={e => set('defaultRefreshInterval', e.target.value === '' ? '' : parseInt(e.target.value, 10))} className="settings-input" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Timezone</label>
                  <select value={(g('timezone') as string) ?? 'UTC'} onChange={e => set('timezone', e.target.value)} className="settings-input">
                    {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo'].map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">Used for VynDB date displays and operational schedules; stored timestamps remain UTC.</p>
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
              <p className="text-[10px] text-slate-500">RPO breach alert is configured in the Thresholds tab and applies globally.</p>
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
