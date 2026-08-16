'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import { Bot, Send, Loader2, Sparkles, User, Zap, BarChart3, Shield, HardDrive, AlertCircle, Database, History, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppRefreshInterval } from '@/lib/use-app-refresh-interval'
import { useAppTimezone, formatAppDate } from '@/lib/use-app-timezone'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Message {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const CAPABILITIES: { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; prompts: string[] }[] = [
  {
    label: 'Query optimization',
    icon: Zap,
    prompts: [
      'What indexes should I add to speed up slow queries on labdb-mysql?',
      'Analyse the current slow queries and suggest the most impactful fixes',
      'Rewrite this slow query for better performance: SELECT * FROM orders WHERE status != \'cancelled\' AND created_at > \'2026-01-01\'',
      'How do I read the EXPLAIN ANALYZE output for a sequential scan on labdb-postgres?',
    ],
  },
  {
    label: 'Performance analysis',
    icon: BarChart3,
    prompts: [
      'Why is labdb-postgres query latency p99 high and how do I fix it?',
      'How do I optimize labdb-mongodb aggregation pipeline performance?',
      'What is the optimal connection pool size for labdb-mysql with my current load?',
      'How do I identify and kill blocking queries on labdb-postgres?',
    ],
  },
  {
    label: 'Security guidance',
    icon: Shield,
    prompts: [
      'What are the top security risks in my current database setup?',
      'How do I fix the superuser login role finding on labdb-postgres?',
      'How do I enable SSL/TLS on a PostgreSQL Docker container?',
      'What privileges should a read-only application user have on labdb-mysql?',
    ],
  },
  {
    label: 'Capacity planning',
    icon: HardDrive,
    prompts: [
      'When will labdb-redis run out of memory and what should I do?',
      'How do I estimate storage growth for labdb-postgres over the next 6 months?',
      'What is the best archival strategy for the events table on labdb-postgres?',
      'How do I reduce index bloat on labdb-postgres?',
    ],
  },
  {
    label: 'Incident RCA',
    icon: AlertCircle,
    prompts: [
      'labdb-mongodb was unreachable earlier today — what are the likely root causes?',
      'How do I investigate a sudden spike in connections on labdb-postgres?',
      'What should I check when a PostgreSQL primary/replica switchover happens unexpectedly?',
      'How do I diagnose high CPU usage on labdb-mysql?',
    ],
  },
  {
    label: 'Backup & recovery',
    icon: Database,
    prompts: [
      'How do I set up point-in-time recovery (PITR) for labdb-postgres?',
      'What is the best RPO/RTO setup for labdb-mongodb in a lab environment?',
      'How do I verify a labdb-postgres backup is valid before relying on it?',
      'Walk me through restoring labdb-mysql from a .sql.gz backup file',
    ],
  },
]

const WELCOME: Message = {
  role: 'assistant',
  content: `Hello! I'm your **VynDB AI Copilot**. I use the provider configured in Settings and ground answers in your connected database evidence. I can help with:\n\n• **Query intelligence** — plans, indexes, bottlenecks, and verification\n• **Performance diagnosis** — waits, blockers, connections, and capacity\n• **Security guidance** — privileges, encryption, configuration, and evidence\n• **Incident RCA** — evidence-based root cause analysis\n• **Backup & recovery** — integrity, restore readiness, and RPO/RTO\n\nI will identify data limitations and ask for approval before destructive actions.`,
  ts: Date.now(),
}

export default function CopilotPage() {
  const refreshInterval = useAppRefreshInterval(30)
  const appTimezone = useAppTimezone()
  const { data: usage } = useSWR('/api/copilot/usage', fetcher, { refreshInterval })
  const { data: dbs } = useSWR('/api/databases', fetcher)
  const { data: historyList, mutate: mutateHistory } = useSWR('/api/copilot/history', fetcher)
  const dbList = Array.isArray(dbs) ? dbs : []
  const sessions = Array.isArray(historyList) ? historyList : []

  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeCategory, setActiveCategory] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const newChat = () => {
    setMessages([{ ...WELCOME, ts: Date.now() }])
    setSessionId(null)
    setInput('')
    setShowHistory(false)
  }

  const loadSession = async (id: string) => {
    const res = await fetch(`/api/copilot/history?id=${id}`)
    const data = await res.json()
    if (data.messages) {
      setMessages(data.messages)
      setSessionId(id)
      setShowHistory(false)
    }
  }

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await fetch(`/api/copilot/history?id=${id}`, { method: 'DELETE' })
    mutateHistory()
    if (sessionId === id) newChat()
  }

  const saveSession = async (msgs: Message[]) => {
    const userMsgs = msgs.filter(m => m.role === 'user')
    if (userMsgs.length === 0) return
    const body = { id: sessionId ?? undefined, messages: msgs }
    const res = await fetch('/api/copilot/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (data.id && !sessionId) setSessionId(data.id)
    mutateHistory()
  }

  const send = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return
    setInput('')

    const userMsg: Message = { role: 'user', content, ts: Date.now() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)

    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          dbContext: dbList.map((d: { name: string; engine: string; status: string; healthScore: number }) =>
            `${d.name} (${d.engine}, ${d.status}, health: ${d.healthScore})`
          ).join(', ')
        }),
      })
      const data = await res.json()
      const assistantMsg: Message = { role: 'assistant', content: data.content ?? 'Sorry, I could not generate a response.', ts: Date.now() }
      const finalMessages = [...newMessages, assistantMsg]
      setMessages(finalMessages)
      // Auto-save after each exchange
      saveSession(finalMessages)
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Network error. Please check your connection and try again.', ts: Date.now() }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function renderMarkdown(text: string) {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    return escaped
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="bg-slate-800 px-1 py-0.5 rounded text-emerald-300 text-[11px] font-mono">$1</code>')
      .replace(/\n/g, '<br/>')
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-2 bg-[#0a0f1e] border-b border-slate-800/60">
        <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
          {usage && (
            <>
              <span className="flex items-center gap-1.5"><Sparkles size={10} className="text-emerald-400" /> Today: {usage.today?.requests ?? 0} req / {(usage.today?.totalTokens ?? 0).toLocaleString()} tokens</span>
              <span>All time: {usage.allTime?.totalTokens?.toLocaleString() ?? 0} tokens</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={newChat}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-colors">
            <Plus size={11} /> New
          </button>
          <button onClick={() => setShowHistory(h => !h)}
            className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors',
              showHistory ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700')}>
            <History size={11} /> History {sessions.length > 0 && <span className="text-[9px] bg-slate-700 px-1.5 rounded-full">{sessions.length}</span>}
          </button>
        </div>
      </div>

      {/* History drawer */}
      {showHistory && (
        <div className="border-b border-slate-800 bg-[#0a0f1e] max-h-60 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-xs text-slate-500 text-center">No history yet</div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {sessions.map((s: { id: string; title: string; updatedAt: string; messageCount: number }) => (
                <button key={s.id} onClick={() => loadSession(s.id)}
                  className={cn('w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/30 transition-colors text-left',
                    sessionId === s.id && 'bg-emerald-500/5 border-l-2 border-emerald-500')}>
                  <History size={11} className="text-slate-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-300 truncate">{s.title}</div>
                    <div className="text-[10px] text-slate-600">{formatAppDate(s.updatedAt, appTimezone, { dateStyle: 'medium', timeStyle: 'short' })} · {s.messageCount} messages</div>
                  </div>
                  <button onClick={e => deleteSession(s.id, e)}
                    className="p-1 rounded hover:bg-red-500/10 text-slate-600 hover:text-red-400 flex-shrink-0">
                    <Trash2 size={10} />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={cn('flex items-start gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}>
            <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
              msg.role === 'assistant' ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-blue-500/20 border border-blue-500/30')}>
              {msg.role === 'assistant' ? <Bot className="w-4 h-4 text-emerald-400" /> : <User className="w-4 h-4 text-blue-400" />}
            </div>
            <div className={cn('max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
              msg.role === 'assistant' ? 'bg-[#0f1629] border border-slate-800 text-slate-200' : 'bg-blue-500/20 border border-blue-500/30 text-slate-100')}>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="bg-[#0f1629] border border-slate-800 rounded-2xl px-4 py-3">
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Capability tabs + linked prompts */}
      <div className="px-4 sm:px-6 pb-3 space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1 flex-nowrap">
          {CAPABILITIES.map((cap, i) => {
            const Icon = cap.icon
            return (
              <button key={cap.label} onClick={() => setActiveCategory(i)}
                className={cn('flex-shrink-0 flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors',
                  activeCategory === i
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-500 hover:text-slate-300 bg-[#0f1629] border border-slate-800 hover:border-slate-700')}>
                <Icon size={10} />{cap.label}
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 flex-nowrap">
          {CAPABILITIES[activeCategory].prompts.map(s => (
            <button key={s} onClick={() => send(s)}
              className="flex-shrink-0 text-xs text-slate-300 bg-[#0f1629] border border-slate-700 hover:border-emerald-500/40 px-3 py-2 rounded-xl transition-colors max-w-[280px] truncate">
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="px-4 sm:px-6 pb-4">
        <div className="flex items-end gap-2 bg-[#0f1629] border border-slate-700 focus-within:border-emerald-500/60 rounded-2xl px-4 py-3 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your databases... (Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none resize-none max-h-32 overflow-y-auto"
            style={{ scrollbarWidth: 'none' }}
          />
          <button onClick={() => send()} disabled={loading || !input.trim()}
            className="w-8 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 flex items-center justify-center flex-shrink-0 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin text-white" /> : <Send size={14} className="text-white" />}
          </button>
        </div>
        <div className="text-[10px] text-slate-600 text-center mt-1.5">AI advice is grounded in available VynDB evidence — verify critical changes before execution</div>
      </div>
    </div>
  )
}
