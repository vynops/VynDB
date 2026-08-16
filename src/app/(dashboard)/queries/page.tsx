'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Brain, Copy, Check, Loader2, ChevronDown, Sparkles, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const ENGINES = ['postgresql', 'mysql', 'sqlserver', 'mongodb', 'redis', 'couchbase']

const SAMPLE_QUERIES: Record<string, string> = {
  postgresql: `SELECT u.id, u.email, COUNT(o.id) AS order_count, SUM(o.total) AS lifetime_value
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > NOW() - INTERVAL '90 days'
GROUP BY u.id, u.email
ORDER BY lifetime_value DESC
LIMIT 100;`,
  mysql: `SELECT p.name, SUM(oi.qty * oi.price) AS revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
WHERE oi.created_at BETWEEN '2026-01-01' AND '2026-06-30'
  AND oi.status != 'cancelled'
GROUP BY p.id, p.name
ORDER BY revenue DESC;`,
}

function CodeBlock({ code, language = '' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative rounded-xl bg-slate-900 border border-slate-700 overflow-hidden">
      <button onClick={copy} className="absolute top-2 right-2 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      </button>
      <pre className="p-4 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">{code}</pre>
    </div>
  )
}

function ConfidenceBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'text-emerald-400 bg-emerald-500/10' : score >= 70 ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10'
  return <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', color)}>Confidence {score}%</span>
}

export default function QueryAnalyzerPage() {
  const { data: dbs } = useSWR('/api/databases', fetcher)
  const dbList = Array.isArray(dbs) ? dbs : []

  const [engine, setEngine] = useState('postgresql')
  const [queryByEngine, setQueryByEngine] = useState<Record<string, string>>({})
  const query = queryByEngine[engine] ?? ''
  const setQuery = (q: string) => setQueryByEngine(prev => ({ ...prev, [engine]: q }))

  const switchEngine = (e: string) => { setEngine(e); setResult(null); setError('') }
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    explanation: string
    bottleneck: string
    suggestions: string[]
    estimatedGain: string
    indexSuggestions: string[]
    confidence: number
  } | null>(null)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const { data: history } = useSWR('/api/slow-queries?analyzed=true', fetcher)
  const analyzedHistory = Array.isArray(history) ? history.filter((q: { analyzed: boolean }) => q.analyzed) : []

  const analyze = async () => {
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/queries/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, engine }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Analysis failed'); return }
      setResult(data)
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  const loadSample = () => {
    setQuery(SAMPLE_QUERIES[engine] ?? SAMPLE_QUERIES.postgresql)
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4">

        {/* Input Card */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Brain className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">AI Query Analyzer</h2>
              <p className="text-xs text-slate-500">Paste any SQL/NoSQL query to get AI-powered analysis, bottleneck detection, and optimization suggestions</p>
            </div>
          </div>

          {/* Engine selector */}
          <div className="flex flex-wrap gap-2">
            {ENGINES.map(e => (
              <button key={e} onClick={() => switchEngine(e)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                  engine === e ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-600')}>
                {e === 'sqlserver' ? 'SQL Server' : e === 'couchbase' ? 'CouchBase' : e === 'mongodb' ? 'MongoDB' : e.charAt(0).toUpperCase() + e.slice(1)}
              </button>
            ))}
          </div>

          {/* Query textarea */}
          <div className="relative">
            <textarea
              value={query}
              onChange={e => setQuery(e.target.value)}
              rows={8}
              placeholder="Paste your SQL query here..."
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/20 resize-none"
            />
            <button onClick={loadSample} className="absolute bottom-3 right-3 text-[10px] text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-600 px-2 py-1 rounded-lg transition-colors">
              Load sample
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <Info size={13} />{error}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={analyze} disabled={loading || !query.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? 'Analyzing…' : 'Analyze with AI'}
            </button>
            <span className="text-xs text-slate-500">Powered by Groq — sub-second analysis</span>
          </div>
        </div>

        {/* Result */}
        {result && (
          <div className="rounded-2xl bg-[#0f1629] border border-emerald-500/20 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" /> Analysis Result
              </h3>
              <ConfidenceBadge score={result.confidence} />
            </div>

            {/* Explanation */}
            <div>
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">What This Query Does</h4>
              <p className="text-sm text-slate-300 leading-relaxed">{result.explanation}</p>
            </div>

            {/* Bottleneck */}
            <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 p-4">
              <h4 className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-1.5">Bottleneck Identified</h4>
              <p className="text-sm text-slate-300">{result.bottleneck}</p>
            </div>

            {/* Suggestions */}
            {result.suggestions.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Optimization Suggestions</h4>
                <ul className="space-y-2">
                  {result.suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Index suggestions */}
            {result.indexSuggestions.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Index Suggestions</h4>
                <div className="space-y-2">
                  {result.indexSuggestions.map((idx, i) => (
                    <CodeBlock key={i} code={idx} language="sql" />
                  ))}
                </div>
              </div>
            )}

            {/* Estimated gain */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
              <Check className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="text-xs font-bold text-emerald-400">Estimated improvement: </span>
                <span className="text-sm text-slate-300">{result.estimatedGain}</span>
              </div>
            </div>
          </div>
        )}

        {/* Analysis history */}
        {analyzedHistory.length > 0 && (
          <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
            <button onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-800/30 transition-colors">
              <span className="text-sm font-bold text-white">Previous Analyses ({analyzedHistory.length})</span>
              <ChevronDown className={cn('w-4 h-4 text-slate-400 transition-transform', showHistory && 'rotate-180')} />
            </button>
            {showHistory && (
              <div className="border-t border-slate-800 divide-y divide-slate-800/60">
                {analyzedHistory.slice(0, 5).map((q: { id: string; query: string; durationMs: number; dbName: string; aiAnalysis: { explanation: string; confidence: number } }) => (
                  <div key={q.id} className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <code className="text-xs text-slate-400 font-mono truncate flex-1">{q.query}</code>
                      <ConfidenceBadge score={q.aiAnalysis.confidence} />
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{q.aiAnalysis.explanation}</p>
                    <div className="text-[10px] text-slate-600 mt-1">{q.dbName} · {q.durationMs}ms</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
