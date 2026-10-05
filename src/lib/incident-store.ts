import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { appendAudit } from './audit-store'

const DATA = path.join(process.cwd(), 'data')
const ensure = () => { if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true }) }

function load<T>(file: string, def: T): T {
  ensure()
  const f = path.join(DATA, file)
  if (!fs.existsSync(f)) return def
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) as T } catch { return def }
}

function save(file: string, data: unknown) {
  ensure()
  const target = path.join(DATA, file)
  const temp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(temp, target)
}

// ─────────────────────────────────────────
// Incidents
// ─────────────────────────────────────────
export interface Incident {
  id: string
  dbId: string
  dbName: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: 'performance' | 'availability' | 'replication' | 'backup' | 'security' | 'capacity' | 'other'
  status: 'open' | 'acknowledged' | 'resolved'
  source: 'auto' | 'manual'
  createdAt: string
  acknowledgedAt?: string
  resolvedAt?: string
  reopenedAt?: string
  assignedTo?: string
  notes?: string
  slaBreach?: boolean
  fingerprint?: string
  notificationEvents?: Array<{ key: string; status: Incident['status']; reopenedAt?: string }>
}

export function incidentFingerprint(data: Pick<Incident, 'dbId' | 'category' | 'title'>): string {
  return `${data.dbId}:${data.category}:${data.title.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim()}`
}

export function findOpenIncidentDuplicate(data: Pick<Incident, 'dbId' | 'category' | 'title' | 'source' | 'fingerprint'>): Incident | null {
  if (data.source !== 'auto') return null
  const fingerprint = data.fingerprint ?? incidentFingerprint(data)
  return loadIncidents().find(item => item.status !== 'resolved' && (item.fingerprint === fingerprint || incidentFingerprint(item) === fingerprint)) ?? null
}

const now = Date.now()

const DEMO_INCIDENTS: Incident[] = [
  {
    id: 'inc-003', dbId: 'db-002', dbName: 'prod-mysql', title: 'Replica lag exceeded 10 seconds',
    severity: 'medium', category: 'replication', status: 'open', source: 'auto',
    createdAt: new Date(now - 1800_000).toISOString(),
  },
  {
    id: 'inc-005', dbId: 'db-001', dbName: 'prod-postgres', title: 'Slow query spike — p99 exceeded 5s',
    severity: 'medium', category: 'performance', status: 'resolved', source: 'auto',
    createdAt: new Date(now - 86400_000).toISOString(),
    acknowledgedAt: new Date(now - 85800_000).toISOString(),
    resolvedAt: new Date(now - 82000_000).toISOString(),
    assignedTo: 'admin@vyndb.local', notes: 'Added composite index. Query time back to normal.',
  },
]

export function loadIncidents(): Incident[] {
  const f = path.join(DATA, 'incidents.json')
  ensure()
  if (!fs.existsSync(f)) {
    saveIncidents([])
    return []
  }
  return JSON.parse(fs.readFileSync(f, 'utf8')) as Incident[]
}

export function saveIncidents(list: Incident[]): void { save('incidents.json', list) }

export function addIncident(data: Omit<Incident, 'id' | 'createdAt'>, actor = 'monitor'): Incident {
  const list = loadIncidents()
  const fingerprint = data.fingerprint ?? incidentFingerprint(data)
  const duplicate = data.source === 'auto' && list.find(item => item.status !== 'resolved' && (item.fingerprint === fingerprint || incidentFingerprint(item) === fingerprint))
  if (duplicate) return duplicate
  const inc: Incident = { ...data, id: `inc-${crypto.randomUUID().slice(0, 8)}`, createdAt: new Date().toISOString(), fingerprint }
  list.unshift(inc)
  saveIncidents(list)
  appendAudit({ actor, action: 'incident.create', resource: 'incident', resourceId: inc.id, success: true, details: { source: inc.source, severity: inc.severity, category: inc.category } })
  return inc
}

export function patchIncident(id: string, patch: Partial<Incident>, actor = 'monitor'): Incident | null {
  const list = loadIncidents()
  const idx = list.findIndex(i => i.id === id)
  if (idx === -1) return null
  const previous = list[idx]
  const updated = { ...previous, ...patch, id: previous.id, createdAt: previous.createdAt }
  if (patch.status === 'open') {
    if (previous.status !== 'open') updated.reopenedAt = new Date().toISOString()
    delete updated.acknowledgedAt
    delete updated.resolvedAt
    updated.slaBreach = false
  } else if (patch.status === 'acknowledged') {
    updated.acknowledgedAt = previous.acknowledgedAt ?? new Date().toISOString()
    delete updated.resolvedAt
  } else if (patch.status === 'resolved') {
    updated.resolvedAt = previous.resolvedAt ?? new Date().toISOString()
  }
  if (patch.status && patch.status !== previous.status) {
    const key = patch.status === 'open' ? 'initial' : `status:${updated.status}:${updated.acknowledgedAt ?? ''}:${updated.resolvedAt ?? ''}`
    updated.notificationEvents = [...(previous.notificationEvents ?? []), { key, status: updated.status, reopenedAt: updated.reopenedAt }]
  }
  list[idx] = updated
  saveIncidents(list)
  appendAudit({ actor, action: patch.slaBreach ? 'incident.sla_breach' : 'incident.update', resource: 'incident', resourceId: id, success: true, details: { fields: Object.keys(patch), previousStatus: previous.status, status: updated.status } })
  return list[idx]
}

// ─────────────────────────────────────────
// On-Call Shifts
// ─────────────────────────────────────────
export interface Shift {
  id: string
  name: string
  userEmail: string
  userName: string
  startTime: string
  endTime: string
  timezone: string
}

// Generate a 6-week rolling on-call schedule (Mon-Sun weekly blocks)
function buildDefaultShifts(): Shift[] {
  const shifts: Shift[] = []
  const team = [
    { userEmail: 'admin@vyndb.local',  userName: 'Admin',        tz: 'UTC' },
    { userEmail: 'viewer@vyndb.local', userName: 'DB Viewer',    tz: 'UTC' },
    { userEmail: 'admin@vyndb.local',  userName: 'Admin',        tz: 'UTC' },
  ]
  // Start from 3 weeks ago, generate 6 weeks
  const baseDate = new Date()
  baseDate.setDate(baseDate.getDate() - 21) // 3 weeks back
  // Align to Monday
  const dayOfWeek = baseDate.getDay()
  baseDate.setDate(baseDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
  baseDate.setHours(0, 0, 0, 0)

  for (let week = 0; week < 6; week++) {
    const person = team[week % team.length]
    const start = new Date(baseDate.getTime() + week * 7 * 86400000)
    const end   = new Date(start.getTime() + 7 * 86400000)
    shifts.push({
      id: `shift-${week + 1}`,
      name: `Week ${week + 1} On-Call`,
      userEmail: person.userEmail,
      userName: person.userName,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      timezone: person.tz,
    })
  }
  return shifts
}

export function loadOncall(): Shift[] {
  const data = load('oncall.json', null as Shift[] | null)
  if (data === null || data.length === 0) {
    const defaults = buildDefaultShifts()
    save('oncall.json', defaults)
    return defaults
  }
  return data
}
export function saveOncall(s: Shift[]): void { save('oncall.json', s) }

export function currentOnCallEmails(): string[] {
  const now = new Date()
  return loadOncall()
    .filter(s => new Date(s.startTime) <= now && new Date(s.endTime) > now)
    .map(s => s.userEmail)
}

export function currentOnCallPerson(): Shift | null {
  const now = new Date()
  return loadOncall().find(s => new Date(s.startTime) <= now && new Date(s.endTime) > now) ?? null
}

// ─────────────────────────────────────────
// Routing Rules
// ─────────────────────────────────────────
export interface RoutingRule {
  id: string
  name: string
  severity: string
  category: string
  notifyEmails: string[]
  notifySlack: boolean
  notifyTeams: boolean
  notifyWebhook: boolean
  notifyOncall: boolean
  escalationPolicyId: string
}

const DEFAULT_ROUTING: RoutingRule[] = [
  {
    id: 'route-critical',
    name: 'Critical — page on-call + Slack',
    severity: 'critical', category: '*',
    notifyEmails: ['admin@vyndb.local'],
    notifySlack: true, notifyOncall: true,
    notifyTeams: false, notifyWebhook: false,
    escalationPolicyId: 'critical',
  },
  {
    id: 'route-high',
    name: 'High — Slack + email',
    severity: 'high', category: '*',
    notifyEmails: ['admin@vyndb.local'],
    notifySlack: true, notifyOncall: false,
    notifyTeams: false, notifyWebhook: false,
    escalationPolicyId: 'default',
  },
  {
    id: 'route-security',
    name: 'Security — all channels',
    severity: '*', category: 'security',
    notifyEmails: ['admin@vyndb.local'],
    notifySlack: true, notifyOncall: true,
    notifyTeams: false, notifyWebhook: false,
    escalationPolicyId: 'critical',
  },
  {
    id: 'route-replication',
    name: 'Replication — Slack only',
    severity: '*', category: 'replication',
    notifyEmails: [],
    notifySlack: true, notifyOncall: false,
    notifyTeams: false, notifyWebhook: false,
    escalationPolicyId: 'default',
  },
  {
    id: 'route-medium',
    name: 'Medium — email only',
    severity: 'medium', category: '*',
    notifyEmails: ['admin@vyndb.local'],
    notifySlack: false, notifyOncall: false,
    notifyTeams: false, notifyWebhook: false,
    escalationPolicyId: 'default',
  },
  {
    id: 'route-low',
    name: 'Low — no notification',
    severity: 'low', category: '*',
    notifyEmails: [],
    notifySlack: false, notifyOncall: false,
    notifyTeams: false, notifyWebhook: false,
    escalationPolicyId: 'default',
  },
]

export function loadRouting(): RoutingRule[] { return load('routing.json', DEFAULT_ROUTING) }
export function saveRouting(r: RoutingRule[]): void { save('routing.json', r) }

export function matchRouting(severity: string, category: string): RoutingRule {
  const rules = loadRouting()
  return (
    rules.find(r => r.severity === severity && r.category === category) ??
    rules.find(r => r.severity === severity && r.category === '*') ??
    rules.find(r => r.severity === '*' && r.category === category) ??
    rules.find(r => r.severity === '*' && r.category === '*') ??
    DEFAULT_ROUTING[0]
  )
}

// ─────────────────────────────────────────
// SLA Policies
// ─────────────────────────────────────────
export interface SlaTier { ackMinutes: number; resolveMinutes: number }
export type SlaConfig = Record<string, SlaTier>

const DEFAULT_SLA: SlaConfig = {
  critical: { ackMinutes: 15,  resolveMinutes: 60   },
  high:     { ackMinutes: 30,  resolveMinutes: 240  },
  medium:   { ackMinutes: 120, resolveMinutes: 480  },
  low:      { ackMinutes: 480, resolveMinutes: 1440 },
}

export function loadSla(): SlaConfig { return { ...DEFAULT_SLA, ...load('sla.json', {}) } }
export function saveSla(s: SlaConfig): void { save('sla.json', s) }

// ─────────────────────────────────────────
// Escalation Policies
// ─────────────────────────────────────────
export interface EscalationStep {
  delayMin: number
  condition?: 'unacknowledged' | 'unresolved'
  notifyEmails: string[]
  notifySlack: boolean
  notifyTeams?: boolean
  notifyWebhook?: boolean
  notifyOncall: boolean
  message?: string
}

export interface EscalationPolicy {
  id: string
  name: string
  steps: EscalationStep[]
}

const DEFAULT_ESCALATIONS: EscalationPolicy[] = [
  {
    id: 'critical',
    name: 'Critical — immediate page + escalation',
    steps: [
      { delayMin: 0, condition: 'unacknowledged', notifyEmails: ['admin@vyndb.local'], notifySlack: true, notifyTeams: false, notifyOncall: true,  message: '🔴 CRITICAL alert — immediate response required' },
      { delayMin: 10, condition: 'unacknowledged', notifyEmails: ['admin@vyndb.local'], notifySlack: true, notifyTeams: false, notifyOncall: true,  message: '⚠️ Still unacknowledged after 10 minutes' },
      { delayMin: 30, condition: 'unresolved', notifyEmails: ['admin@vyndb.local'], notifySlack: true, notifyTeams: false, notifyOncall: false, message: '🚨 Unresolved for 30 minutes — management escalation' },
    ],
  },
  {
    id: 'default',
    name: 'Standard — ack reminder + escalation',
    steps: [
      { delayMin: 15, condition: 'unacknowledged', notifyEmails: [], notifySlack: true, notifyTeams: false, notifyOncall: true,  message: 'Reminder: incident unacknowledged for 15 minutes' },
      { delayMin: 60, condition: 'unresolved', notifyEmails: [], notifySlack: true, notifyTeams: false, notifyOncall: true,  message: 'Escalation: incident unresolved for 1 hour' },
      { delayMin: 240, condition: 'unresolved', notifyEmails: ['admin@vyndb.local'], notifySlack: true, notifyTeams: false, notifyOncall: false, message: 'Critical escalation: unresolved for 4 hours' },
    ],
  },
]

export function loadEscalations(): EscalationPolicy[] {
  return load('escalations.json', DEFAULT_ESCALATIONS).map(policy => ({
    ...policy,
    steps: policy.steps.map(step => ({
      ...step,
      condition: step.condition ?? DEFAULT_ESCALATIONS.find(item => item.id === policy.id)?.steps.find(item => item.delayMin === step.delayMin)?.condition,
    })),
  }))
}
export function saveEscalations(e: EscalationPolicy[]): void { save('escalations.json', e) }
