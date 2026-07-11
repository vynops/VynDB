'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { GitMerge, Plus, Trash2, X, Loader2, ChevronDown, ChevronRight, Edit2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const SEVERITIES = ['*', 'critical', 'high', 'medium', 'low']
const CATEGORIES = ['*', 'performance', 'availability', 'replication', 'backup', 'security', 'capacity', 'other']

interface RoutingRule {
  id: string; name: string; severity: string; category: string;
  notifyEmails: string[]; notifySlack: boolean; notifyOncall: boolean; escalationPolicyId: string
}

interface EscalationStep {
  delayMin: number; notifyEmails: string[]; notifySlack: boolean; notifyOncall: boolean; message?: string
}

interface EscalationPolicy {
  id: string; name: string; steps: EscalationStep[]
}

export default function RoutingPage() {
  const { data: routing, mutate: mutateR } = useSWR('/api/routing', fetcher)
  const { data: escalations, mutate: mutateE } = useSWR('/api/escalations', fetcher)
  const { data: sla, mutate: mutateSla } = useSWR('/api/sla', fetcher)

  const rules: RoutingRule[] = Array.isArray(routing) ? routing : []
  const policies: EscalationPolicy[] = Array.isArray(escalations) ? escalations : []

  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editRuleId, setEditRuleId] = useState<string | null>(null)
  const EMPTY_RULE = { name: '', severity: '*', category: '*', notifyEmails: '', notifySlack: true, notifyOncall: true, escalationPolicyId: 'default' }
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE)
  const [saving, setSaving] = useState(false)
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null)

  const handleSaveRule = async () => {
    setSaving(true)
    if (editRuleId) {
      await fetch(`/api/routing/${editRuleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ruleForm, notifyEmails: ruleForm.notifyEmails.split(',').map(e => e.trim()).filter(Boolean) }),
      })
    } else {
      await fetch('/api/routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ruleForm, notifyEmails: ruleForm.notifyEmails.split(',').map(e => e.trim()).filter(Boolean) }),
      })
    }
    mutateR()
    setSaving(false)
    setShowRuleModal(false)
    setEditRuleId(null)
    setRuleForm(EMPTY_RULE)
  }

  const openEdit = (rule: RoutingRule) => {
    setEditRuleId(rule.id)
    setRuleForm({ name: rule.name, severity: rule.severity, category: rule.category, notifyEmails: rule.notifyEmails.join(', '), notifySlack: rule.notifySlack, notifyOncall: rule.notifyOncall, escalationPolicyId: rule.escalationPolicyId })
    setShowRuleModal(true)
  }

  const handleDeleteRule = async (id: string) => {
    await fetch(`/api/routing/${id}`, { method: 'DELETE' })
    mutateR()
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Routing Rules */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-white">Alert Routing Rules</h2>
            <p className="text-xs text-slate-500">Rules are evaluated top-to-bottom — first match wins</p>
          </div>
          <button onClick={() => setShowRuleModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-xs transition-colors">
            <Plus size={13} /> Add Rule
          </button>
        </div>
        <div className="divide-y divide-slate-800/60">
          {rules.map(rule => (
            <div key={rule.id} className="flex items-start gap-3 px-5 py-4">
              <GitMerge className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-semibold text-white">{rule.name}</span>
                  <span className={cn('text-[9px] px-2 py-0.5 rounded-full font-bold uppercase', rule.severity === '*' ? 'bg-slate-700 text-slate-400' : 'bg-orange-500/10 text-orange-400')}>sev: {rule.severity === '*' ? 'Any' : rule.severity}</span>
                  <span className={cn('text-[9px] px-2 py-0.5 rounded-full font-bold uppercase', rule.category === '*' ? 'bg-slate-700 text-slate-400' : 'bg-blue-500/10 text-blue-400')}>cat: {rule.category === '*' ? 'Any' : rule.category}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
                  {rule.notifySlack && <span className="bg-slate-800 px-1.5 py-0.5 rounded">Slack</span>}
                  {rule.notifyOncall && <span className="bg-slate-800 px-1.5 py-0.5 rounded">On-call</span>}
                  {rule.notifyEmails.map(e => <span key={e} className="bg-slate-800 px-1.5 py-0.5 rounded">{e}</span>)}
                  {rule.escalationPolicyId && <span className="text-violet-400">→ {rule.escalationPolicyId}</span>}
                </div>
              </div>
              {rule.id !== 'default' && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(rule)} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-slate-300">
                    <Edit2 size={12} />
                  </button>
                  <button onClick={() => handleDeleteRule(rule.id)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Escalation Policies */}
      <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-bold text-white">Escalation Policies</h2>
          <p className="text-xs text-slate-500">Automatic escalation steps if incidents remain unacknowledged/unresolved</p>
        </div>
        <div className="divide-y divide-slate-800/60">
          {policies.map(policy => (
            <div key={policy.id}>
              <button onClick={() => setExpandedPolicy(p => p === policy.id ? null : policy.id)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-800/20 transition-colors">
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="flex-1 text-sm font-semibold text-white text-left">{policy.name}</span>
                <span className="text-xs text-slate-500">{policy.steps.length} steps</span>
                {expandedPolicy === policy.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              </button>
              {expandedPolicy === policy.id && (
                <div className="px-5 pb-4 space-y-2">
                  {policy.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-900 border border-slate-700">
                      <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</div>
                      <div className="flex-1 text-xs">
                        <div className="font-semibold text-white">After {step.delayMin}m</div>
                        {step.message && <div className="text-slate-400 mt-0.5">"{step.message}"</div>}
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {step.notifySlack && <span className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">Slack</span>}
                          {step.notifyOncall && <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">On-call</span>}
                          {step.notifyEmails.map(e => <span key={e} className="bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">{e}</span>)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SLA Config */}
      {sla && (
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-bold text-white">SLA Targets</h2>
            <p className="text-xs text-slate-500">Time to acknowledge and resolve by severity</p>
          </div>
          <div className="p-5">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(sla).map(([sev, tier]) => {
                const t = tier as { ackMinutes: number; resolveMinutes: number }
                return (
                  <div key={sev} className="p-3 rounded-xl bg-slate-900 border border-slate-700">
                    <div className={cn('text-xs font-bold uppercase mb-2',
                      sev === 'critical' ? 'text-red-400' : sev === 'high' ? 'text-orange-400' : sev === 'medium' ? 'text-yellow-400' : 'text-blue-400')}>
                      {sev}
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Ack in</span><span className="text-white font-bold">{t.ackMinutes}m</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Resolve in</span><span className="text-white font-bold">{Math.round(t.resolveMinutes / 60 * 10) / 10}h</span></div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Add Rule Modal */}
      {showRuleModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowRuleModal(false)}>
          <div className="bg-[#111827] border border-slate-700 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700">
              <h2 className="text-sm font-bold text-white">{editRuleId ? 'Edit Routing Rule' : 'Add Routing Rule'}</h2>
              <button onClick={() => setShowRuleModal(false)}><X size={15} className="text-slate-400 hover:text-white" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Rule Name *</label>
                <input value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} placeholder="Critical DB alerts → DBA team" className="settings-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Severity</label>
                  <select value={ruleForm.severity} onChange={e => setRuleForm(f => ({ ...f, severity: e.target.value }))} className="settings-input">
                    {SEVERITIES.map(s => <option key={s} value={s}>{s === '*' ? 'Any' : s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-1">Category</label>
                  <select value={ruleForm.category} onChange={e => setRuleForm(f => ({ ...f, category: e.target.value }))} className="settings-input">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c === '*' ? 'Any' : c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Notify Emails (comma-separated)</label>
                <input value={ruleForm.notifyEmails} onChange={e => setRuleForm(f => ({ ...f, notifyEmails: e.target.value }))} placeholder="dba@company.com, ops@company.com" className="settings-input" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">Escalation Policy</label>
                <select value={ruleForm.escalationPolicyId} onChange={e => setRuleForm(f => ({ ...f, escalationPolicyId: e.target.value }))} className="settings-input">
                  <option value="default">default</option>
                  {policies.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
                </select>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={ruleForm.notifySlack} onChange={e => setRuleForm(f => ({ ...f, notifySlack: e.target.checked }))} className="w-4 h-4 rounded" />
                  Slack
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input type="checkbox" checked={ruleForm.notifyOncall} onChange={e => setRuleForm(f => ({ ...f, notifyOncall: e.target.checked }))} className="w-4 h-4 rounded" />
                  On-Call
                </label>
              </div>
              <button onClick={handleSaveRule} disabled={saving || !ruleForm.name}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 size={13} className="animate-spin" />} Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
