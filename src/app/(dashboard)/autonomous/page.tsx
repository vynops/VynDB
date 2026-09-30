'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  Brain, CheckCircle, XCircle, Clock, Loader2, ChevronDown, ChevronRight,
  Zap, Shield, TrendingDown, Database, AlertTriangle, BarChart3, Code,
  X, Eye, EyeOff,
} from 'lucide-react'
import { cn, timeAgo } from '@/lib/utils'
import { permittedMaintenanceSql } from '@/lib/maintenance-policy'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type AutonomousStatus = 'pending' | 'approved' | 'executed' | 'dismissed' | 'failed' | 'unverified'
type AutonomousRisk = 'low' | 'medium' | 'high'
type Severity = 'critical' | 'high' | 'medium' | 'low'

interface AutonomousProposal {
  id: string; source: string; title: string; description: string
  dbId: string; dbName: string; engine: string
  severity: Severity; actionType: string; proposedAction: string
  sql?: string; risk: AutonomousRisk; confidence: number; estimatedGain: string
  status: AutonomousStatus
  createdAt: string; executedAt?: string; executedBy?: string; executionOutput?: string
  evidence?: string[]; requiredPermission?: string; rollback?: string; verification?: string[]
}

const SEV_CONFIG: Record<Severity, { cls: string; dot: string; label: string }> = {
  critical: { cls: 'bg-red-500/15 text-red-400 border-red-500/30',     dot: 'bg-red-500',    label: 'Critical' },
  high:     { cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-500', label: 'High' },
  medium:   { cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-500', label: 'Medium' },
  low:      { cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30',  dot: 'bg-slate-500',  label: 'Low' },
}

const RISK_CONFIG: Record<AutonomousRisk, { cls: string; label: string }> = {
  low:    { cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', label: 'Low Risk' },
  medium: { cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',   label: 'Med Risk' },
  high:   { cls: 'text-red-400 bg-red-500/10 border-red-500/20',             label: 'High Risk' },
}

const SOURCE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  slow_query:  Zap,
  performance: BarChart3,
  incident:    AlertTriangle,
  capacity:    TrendingDown,
  security:    Shield,
  ai_scan:     Brain,
}

const SOURCE_LABELS: Record<string, string> = {
  slow_query: 'Slow Query', performance: 'Performance', incident: 'Incident',
  capacity: 'Capacity', security: 'Security', ai_scan: 'AI Scan',
}

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 90 ? 'bg-emerald-500' : value >= 75 ? 'bg-yellow-500' : 'bg-orange-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 bg-slate-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] text-slate-400 font-mono">{value}%</span>
    </div>
  )
}

export default function AutonomousPage() {
  const { data: proposals = [], mutate } = useSWR<AutonomousProposal[]>('/api/autonomous', fetcher)

  const [tab, setTab] = useState<'all' | 'pending' | 'executed' | 'dismissed'>('pending')
  const [sevFilter, setSevFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [approveResult, setApproveResult] = useState<{ id: string; output: string; status: string } | null>(null)
  const [dryRunResult, setDryRunResult] = useState<{ id: string; action: string; sql?: string } | null>(null)

  const filtered = proposals
    .filter(p => tab === 'all' || p.status === tab)
    .filter(p => sevFilter === 'all' || p.severity === sevFilter)
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 }
      return (order[a.severity] ?? 4) - (order[b.severity] ?? 4)
    })

  const counts = {
    pending:  proposals.filter(p => p.status === 'pending').length,
    executed: proposals.filter(p => p.status === 'executed').length,
    dismissed: proposals.filter(p => p.status === 'dismissed').length,
  }

  const handleApprove = async (id: string) => {
    setApprovingId(id)
    try {
      const res = await fetch(`/api/autonomous/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) })
      const data = await res.json()
      setApproveResult({ id, status: data.status ?? 'failed', output: data.output ?? data.error ?? 'Execution outcome unavailable' })
      if (data.status !== 'pending') setTab('all')
      mutate()
    } finally { setApprovingId(null) }
  }

  const handleDryRun = async (id: string) => {
    setApprovingId(id)
    try {
      const res = await fetch(`/api/autonomous/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true }) })
      const data = await res.json()
      if (res.ok) setDryRunResult({ id, action: data.proposal?.proposedAction ?? '', sql: data.proposal?.sql })
    } finally { setApprovingId(null) }
  }

  const handleDismiss = async (id: string) => {
    setDismissingId(id)
    try {
      await fetch(`/api/autonomous/${id}/dismiss`, { method: 'POST' })
      mutate()
    } finally { setDismissingId(null) }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Pending',      value: counts.pending,     color: 'text-yellow-400' },
          { label: 'Executed',     value: counts.executed,    color: 'text-emerald-400' },
          { label: 'Dismissed',    value: counts.dismissed,   color: 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-4">
            <div className={cn('text-2xl font-bold', s.color)}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Header + approval gate status */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Autonomous Ops</h2>
          <p className="text-sm text-slate-400 mt-0.5">AI-detected issues with proposed self-healing actions</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border bg-emerald-500/10 border-emerald-500/20 text-emerald-400 text-xs font-medium">
          <Shield size={15} /> Approval gate active · no global auto-execution
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
        <Eye size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-200/70">Review the evidence and preview the action before approving. Only supported maintenance can run here; other actions require manual execution.</div>
      </div>

      {/* Tabs + Severity filter */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex bg-slate-900/60 border border-slate-800/40 rounded-lg p-0.5 gap-0.5">
          {(['all', 'pending', 'executed', 'dismissed'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn('px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300')}>
              {t === 'all' ? 'All' : t === 'pending' ? `Pending (${counts.pending})` : t === 'executed' ? `Executed (${counts.executed})` : `Dismissed (${counts.dismissed})`}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map(s => (
            <button key={s} onClick={() => setSevFilter(s)}
              className={cn('px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-colors border',
                sevFilter === s
                  ? (s === 'all' ? 'bg-slate-700 border-slate-600 text-white' : cn(SEV_CONFIG[s as Severity].cls))
                  : 'bg-transparent border-slate-800/40 text-slate-600 hover:text-slate-400')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Proposals List */}
      <div className="space-y-3">
        {filtered.map(proposal => {
          const sev = SEV_CONFIG[proposal.severity]
          const risk = RISK_CONFIG[proposal.risk]
          const SourceIcon = SOURCE_ICONS[proposal.source] ?? Brain
          const isExpanded = expandedId === proposal.id
          const isPending = proposal.status === 'pending'

          return (
            <div key={proposal.id}
              className={cn('bg-slate-900/60 border rounded-xl overflow-hidden transition-all',
                isPending ? 'border-slate-800/60' : 'border-slate-800/30 opacity-75')}>

              {/* Severity accent bar */}
              <div className={cn('h-0.5 w-full', sev.dot)} />

              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Severity dot + Source icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center border', sev.cls)}>
                      <SourceIcon size={13} />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase', sev.cls)}>
                            {sev.label}
                          </span>
                          <span className="text-[10px] text-slate-500">{SOURCE_LABELS[proposal.source] ?? proposal.source}</span>
                          <span className="text-[10px] text-slate-600">•</span>
                          <span className="text-[10px] text-slate-500">{proposal.dbName}</span>
                        </div>
                        <div className="text-sm font-semibold text-white mt-1.5">{proposal.title}</div>
                        <div className="text-xs text-slate-400 mt-1 leading-relaxed">{proposal.description}</div>
                      </div>

                      {/* Status for non-pending */}
                      {!isPending && (
                        <div className="flex-shrink-0">
                          {proposal.status === 'executed' && (
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                              <CheckCircle size={12} /> Executed
                            </span>
                          )}
                          {proposal.status === 'dismissed' && (
                            <span className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                              <XCircle size={12} /> Dismissed
                            </span>
                          )}
                          {proposal.status === 'failed' && (
                            <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
                              <XCircle size={12} /> Failed
                            </span>
                          )}
                          {proposal.status === 'unverified' && (
                            <span className="flex items-center gap-1 text-xs text-amber-400 font-medium">
                              <AlertTriangle size={12} /> Needs investigation
                            </span>
                          )}
                          {proposal.status === 'approved' && (
                            <span className="flex items-center gap-1 text-xs text-blue-400 font-medium">
                              <Eye size={12} /> Manual action
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 mt-3 flex-wrap">
                      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded border', risk.cls)}>
                        {risk.label}
                      </span>
                      <div className="flex items-center gap-1">
                        <Brain size={10} className="text-slate-500" />
                        <span className="text-[10px] text-slate-500">Confidence:</span>
                        <ConfidenceBar value={proposal.confidence} />
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingDown size={10} className="text-emerald-500" />
                        <span className="text-[10px] text-emerald-400">{proposal.estimatedGain}</span>
                      </div>
                      {proposal.createdAt && (
                        <span className="text-[10px] text-slate-600">{timeAgo(proposal.createdAt)}</span>
                      )}
                    </div>

                    {/* Proposed action */}
                    <div className="mt-3 p-2.5 bg-slate-950/40 border border-slate-700/30 rounded-lg">
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Proposed Action</div>
                      <code className="text-xs text-cyan-400 font-mono">{proposal.proposedAction}</code>
                    </div>

                    {proposal.evidence && proposal.evidence.length > 0 && (
                      <div className="mt-2 p-2.5 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                        <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">Evidence</div>
                        <ul className="text-[11px] text-slate-300 space-y-1">{proposal.evidence.map((item, index) => <li key={index}>• {item}</li>)}</ul>
                      </div>
                    )}

                    {(proposal.requiredPermission || proposal.rollback || (proposal.verification && proposal.verification.length > 0)) && (
                      <div className="mt-2 grid sm:grid-cols-3 gap-2 text-[11px]">
                        {proposal.requiredPermission && <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-700/30"><div className="text-slate-500 mb-1">Permission</div><div className="text-slate-300">{proposal.requiredPermission}</div></div>}
                        {proposal.rollback && <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-700/30"><div className="text-slate-500 mb-1">Rollback</div><div className="text-slate-300">{proposal.rollback}</div></div>}
                        {proposal.verification && proposal.verification.length > 0 && <div className="p-2 rounded-lg bg-slate-950/40 border border-slate-700/30"><div className="text-slate-500 mb-1">Verify after action</div><div className="text-slate-300">{proposal.verification.join(' ')}</div></div>}
                      </div>
                    )}

                    {/* Execution output */}
                    {proposal.executionOutput && (
                      <div className={cn('mt-2 p-2.5 rounded-lg border', proposal.status === 'executed' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20')}>
                        <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                          {proposal.status === 'executed' ? 'Verified' : proposal.status === 'unverified' ? 'Investigate before retrying' : 'Outcome'} · {proposal.executedBy ?? 'operator'}
                        </div>
                        <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{proposal.executionOutput}</pre>
                      </div>
                    )}

                    {/* Inline approve result */}
                    {approveResult?.id === proposal.id && (
                      <div className={cn('mt-2 p-2.5 rounded-lg border', approveResult.status === 'executed' ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20')}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{approveResult.status === 'executed' ? 'Verified' : approveResult.status === 'approved' ? 'Approved for Manual Action' : approveResult.status === 'unverified' ? 'Investigate before retrying' : 'Action Failed'}</span>
                          <button onClick={() => setApproveResult(null)} className="text-slate-600 hover:text-slate-400">
                            <X size={10} />
                          </button>
                        </div>
                        <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">{approveResult.output}</pre>
                      </div>
                    )}

                    {dryRunResult?.id === proposal.id && (
                      <div className="mt-2 p-2.5 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                        <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">Preview · No Changes Applied</div>
                        <div className="text-xs text-slate-300 mb-2">{dryRunResult.action}</div>
                        {dryRunResult.sql && <pre className="text-[11px] text-cyan-300/80 font-mono whitespace-pre-wrap">{dryRunResult.sql}</pre>}
                      </div>
                    )}

                    {/* SQL expandable */}
                    {proposal.sql && (
                      <div className="mt-2">
                        <button onClick={() => setExpandedId(isExpanded ? null : proposal.id)}
                          className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500 hover:text-slate-300 transition-colors">
                          <Code size={10} />
                          {isExpanded ? 'Hide SQL' : 'View SQL'}
                          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        </button>
                        {isExpanded && (
                          <pre className="mt-2 p-3 bg-slate-950/60 border border-slate-700/40 rounded-lg text-[11px] text-cyan-300 font-mono whitespace-pre-wrap overflow-x-auto">
                            {proposal.sql}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Action buttons (pending only) */}
                    {isPending && (
                      <div className="flex items-center gap-2 mt-4 flex-wrap">
                        <button onClick={() => handleDryRun(proposal.id)}
                          disabled={!!approvingId}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 border border-blue-500/30 transition-colors">
                          {approvingId === proposal.id ? <Loader2 size={11} className="animate-spin" /> : <Eye size={11} />} Preview
                        </button>
                        <button onClick={() => handleApprove(proposal.id)}
                          disabled={!!approvingId}
                          className={cn(
                            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                            proposal.risk === 'high'
                              ? 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30'
                              : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                          )}>
                          {approvingId === proposal.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : <CheckCircle size={11} />
                          }
                          {permittedMaintenanceSql(proposal.engine, proposal.actionType, proposal.sql ?? '')
                            ? 'Approve & Run' : 'Approve for Manual Action'}
                        </button>

                        <button onClick={() => handleDismiss(proposal.id)}
                          disabled={!!dismissingId}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/40 transition-colors">
                          {dismissingId === proposal.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                          Dismiss
                        </button>

                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No proposals in this view.</p>
            <p className="text-xs mt-1 text-slate-600">AI continuously monitors your databases for optimization opportunities.</p>
          </div>
        )}
      </div>
    </div>
  )
}
