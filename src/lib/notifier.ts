import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSettings } from './settings-store'
import { currentOnCallEmails, type Incident, type RoutingRule } from './incident-store'
import { appendAudit } from './audit-store'

const NOTIFY_STATE = path.join(process.cwd(), 'data', 'notification-state.json')
const NOTIFY_LOG = path.join(process.cwd(), 'data', 'notification-log.json')

function targetFingerprint(target: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(target)).digest('hex')
}

function saveIncidentDeliveryState(file: string, state: Record<string, DeliveryResult>) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(state), 'utf8')
  fs.renameSync(temp, file)
}

function logDelivery(channel: string, ok: boolean, message: string) {
  try {
    let entries: Array<{ channel: string; ok: boolean; message: string; createdAt: string }> = []
    try { entries = JSON.parse(fs.readFileSync(NOTIFY_LOG, 'utf8')) as typeof entries } catch { /* first delivery */ }
    entries.unshift({ channel, ok, message: message.substring(0, 500), createdAt: new Date().toISOString() })
    fs.mkdirSync(path.dirname(NOTIFY_LOG), { recursive: true })
    const temp = `${NOTIFY_LOG}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(entries.slice(0, 1000)), 'utf8')
    fs.renameSync(temp, NOTIFY_LOG)
  } catch { /* notification logging must not block delivery */ }
}

function claimNotification(key: string): boolean {
  const cooldownMs = Math.max(0, getSettings().notifyCooldownMinutes ?? 30) * 60_000
  if (cooldownMs === 0) return true
  const now = Date.now()
  let state: Record<string, number> = {}
  try { state = JSON.parse(fs.readFileSync(NOTIFY_STATE, 'utf8')) as Record<string, number> } catch { /* first send */ }
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  if (now - (state[hash] ?? 0) < cooldownMs) return false
  state[hash] = now
  const cutoff = now - cooldownMs * 2
  for (const [entry, timestamp] of Object.entries(state)) if (timestamp < cutoff) delete state[entry]
  fs.mkdirSync(path.dirname(NOTIFY_STATE), { recursive: true })
  const temp = `${NOTIFY_STATE}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(state), 'utf8')
  fs.renameSync(temp, NOTIFY_STATE)
  return true
}

export type DeliveryResult = 'sent' | 'skipped' | 'failed'

export type IncidentChannelOutcome = 'sent' | 'not_applicable' | 'configuration_error' | 'failed'

export interface IncidentDeliveryReport {
  complete: boolean
  channels: Array<{ channel: string; outcome: IncidentChannelOutcome }>
}

function releaseNotification(key: string) {
  let state: Record<string, number> = {}
  try { state = JSON.parse(fs.readFileSync(NOTIFY_STATE, 'utf8')) as Record<string, number> } catch { return }
  delete state[crypto.createHash('sha256').update(key).digest('hex')]
  const temp = `${NOTIFY_STATE}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(state), 'utf8')
  fs.renameSync(temp, NOTIFY_STATE)
}

export async function sendSlack(text: string): Promise<DeliveryResult> {
  const { slackWebhookUrl } = getSettings()
  if (!slackWebhookUrl) return 'skipped'
  const key = `slack:${slackWebhookUrl}:${text}`
  if (!claimNotification(key)) return 'skipped'
  try {
    const res = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    })
    logDelivery('slack', res.ok, res.ok ? 'delivered' : `HTTP ${res.status}`)
    if (!res.ok) releaseNotification(key)
    if (!res.ok) console.error('[vyndb:notifier] Slack webhook failed:', res.status)
    return res.ok ? 'sent' : 'failed'
  } catch (e) {
    releaseNotification(key)
    logDelivery('slack', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Slack error:', e)
    return 'failed'
  }
}

export async function sendTeams(text: string): Promise<DeliveryResult> {
  const { teamsWebhookUrl } = getSettings()
  if (!teamsWebhookUrl) return 'skipped'
  const key = `teams:${teamsWebhookUrl}:${text}`
  if (!claimNotification(key)) return 'skipped'
  try {
    const res = await fetch(teamsWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: text,
        text,
      }),
    })
    logDelivery('teams', res.ok, res.ok ? 'delivered' : `HTTP ${res.status}`)
    if (!res.ok) releaseNotification(key)
    if (!res.ok) console.error('[vyndb:notifier] Teams webhook failed:', res.status)
    return res.ok ? 'sent' : 'failed'
  } catch (e) {
    releaseNotification(key)
    logDelivery('teams', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Teams error:', e)
    return 'failed'
  }
}

export async function sendWebhook(payload: Record<string, unknown>): Promise<DeliveryResult> {
  const { customWebhookUrl } = getSettings()
  if (!customWebhookUrl) return 'skipped'
  const serialized = JSON.stringify(payload)
  const key = `webhook:${customWebhookUrl}:${serialized}`
  if (!claimNotification(key)) return 'skipped'
  try {
    const res = await fetch(customWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    logDelivery('webhook', res.ok, res.ok ? 'delivered' : `HTTP ${res.status}`)
    if (!res.ok) releaseNotification(key)
    if (!res.ok) console.error('[vyndb:notifier] Custom webhook failed:', res.status)
    return res.ok ? 'sent' : 'failed'
  } catch (e) {
    releaseNotification(key)
    logDelivery('webhook', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Custom webhook error:', e)
    return 'failed'
  }
}

export async function sendEmail(to: string[], subject: string, body: string): Promise<DeliveryResult> {
  const s = getSettings()
  if (!s.alertEmailEnabled || !s.smtpHost || to.length === 0) return 'skipped'
  const key = `email:${JSON.stringify({
    recipients: [...new Set(to)].sort(),
    subject,
    body,
    smtp: { host: s.smtpHost, port: s.smtpPort, user: s.smtpUser, password: s.smtpPassword, from: s.smtpFrom },
  })}`
  if (!claimNotification(key)) return 'skipped'
  try {
    const transporter = nodemailer.createTransport({
      host: s.smtpHost,
      port: s.smtpPort || 587,
      secure: s.smtpPort === 465,
      auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    })
    const result = await transporter.sendMail({
      from: s.smtpFrom || s.smtpUser,
      to: to.join(', '),
      subject,
      text: body,
      html: `<pre style="font-family:monospace;font-size:13px">${body.replace(/</g, '&lt;')}</pre>`,
    })
    if (result.rejected?.length) throw new Error(`SMTP rejected ${result.rejected.length} recipient(s)`)
    logDelivery('email', true, `delivered to ${to.length} recipient(s)`)
    return 'sent'
  } catch (e) {
    releaseNotification(key)
    logDelivery('email', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Email error:', e)
    return 'failed'
  }
}

export async function notifyIncidentDetailed(
  incident: Incident,
  targets: Pick<RoutingRule, 'notifySlack' | 'notifyTeams' | 'notifyWebhook' | 'notifyOncall' | 'notifyEmails'>,
  notificationKey = 'initial',
  message = `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}\nIncident: ${incident.id}\nDatabase: ${incident.dbName}\nCategory: ${incident.category}\nStatus: ${incident.status}`,
): Promise<IncidentDeliveryReport> {
  const file = path.join(process.cwd(), 'data', 'incident-deliveries.json')
  let state: Record<string, DeliveryResult> = {}
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof state } catch {}
  const settings = getSettings()
  const oncallEmails = targets.notifyOncall ? currentOnCallEmails() : []
  const emails = [...targets.notifyEmails]
  const escalation = notificationKey.startsWith('escalation:')
  if (!escalation && settings.alertRecipients) emails.push(...settings.alertRecipients.split(',').map(email => email.trim()).filter(Boolean))
  const generalEmails = [...new Set(emails)].filter(email => !oncallEmails.includes(email))
  const deliveryMessage = `${message}\nNotification: ${notificationKey}\nCycle: ${incident.reopenedAt ?? incident.createdAt ?? 'original'}`
  const deliveryBaseKey = `${incident.id}:${incident.reopenedAt ?? 'original'}:${notificationKey}`
  const smtpTarget = { host: settings.smtpHost, port: settings.smtpPort, user: settings.smtpUser, password: settings.smtpPassword, from: settings.smtpFrom }
  const deliveries: Array<{ channel: string; target: unknown; deliver: () => Promise<DeliveryResult> }> = []
  const channels: IncidentDeliveryReport['channels'] = []
  if (targets.notifySlack) {
    if (!settings.slackWebhookUrl) channels.push({ channel: 'slack', outcome: 'configuration_error' })
    else deliveries.push({ channel: 'slack', target: { destination: settings.slackWebhookUrl }, deliver: () => sendSlack(deliveryMessage) })
  } else channels.push({ channel: 'slack', outcome: 'not_applicable' })
  if (targets.notifyTeams) {
    if (!settings.teamsWebhookUrl) channels.push({ channel: 'teams', outcome: 'configuration_error' })
    else deliveries.push({ channel: 'teams', target: { destination: settings.teamsWebhookUrl }, deliver: () => sendTeams(deliveryMessage) })
  } else channels.push({ channel: 'teams', outcome: 'not_applicable' })
  if (targets.notifyWebhook) {
    if (!settings.customWebhookUrl) channels.push({ channel: 'webhook', outcome: 'configuration_error' })
    else deliveries.push({ channel: 'webhook', target: { destination: settings.customWebhookUrl, team: settings.notificationTeam }, deliver: () => sendWebhook({ alert_type: escalation ? 'escalation' : 'incident', incidentId: incident.id, title: incident.title, severity: incident.severity, category: incident.category, status: incident.status, database: incident.dbName, team: settings.notificationTeam || undefined, notificationKey, reopenedAt: incident.reopenedAt, message: deliveryMessage }) })
  } else channels.push({ channel: 'webhook', outcome: 'not_applicable' })
  if (generalEmails.length) {
    if (!settings.alertEmailEnabled) channels.push({ channel: 'email', outcome: 'not_applicable' })
    else if (!settings.smtpHost) channels.push({ channel: 'email', outcome: 'configuration_error' })
    else deliveries.push({ channel: 'email', target: { recipients: [...generalEmails].sort(), smtp: smtpTarget }, deliver: () => sendEmail(generalEmails, `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}`, deliveryMessage) })
  } else channels.push({ channel: 'email', outcome: 'not_applicable' })
  if (targets.notifyOncall) {
    if (!settings.alertEmailEnabled) channels.push({ channel: 'oncall', outcome: 'not_applicable' })
    else if (oncallEmails.length === 0 || !settings.smtpHost) channels.push({ channel: 'oncall', outcome: 'configuration_error' })
    else deliveries.push({ channel: 'oncall', target: { recipients: [...new Set(oncallEmails)].sort(), smtp: smtpTarget }, deliver: () => sendEmail([...new Set(oncallEmails)], `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}`, deliveryMessage) })
  } else channels.push({ channel: 'oncall', outcome: 'not_applicable' })
  let complete = true
  for (const { channel, target, deliver } of deliveries) {
    const legacyKey = `${deliveryBaseKey}:${channel}`
    const key = `${legacyKey}:${targetFingerprint(target)}`
    if (state[key] === 'sent') {
      channels.push({ channel, outcome: 'sent' })
      continue
    }
    if (state[legacyKey] === 'sent') {
      state[key] = 'sent'
      delete state[legacyKey]
      saveIncidentDeliveryState(file, state)
      channels.push({ channel, outcome: 'sent' })
      continue
    }
    const result = await deliver().catch(() => 'failed' as const)
    const outcome: IncidentChannelOutcome = result === 'sent' ? 'sent'
      : result === 'failed' || result === 'skipped' ? 'failed' : 'configuration_error'
    if (outcome !== 'sent') complete = false
    channels.push({ channel, outcome })
    if (result !== state[key] || result === 'failed' || outcome === 'configuration_error') {
      appendAudit({ actor: 'notifier', action: 'incident.notify', resource: 'incident', resourceId: incident.id, success: result === 'sent', details: { channel, notificationKey, result } })
    }
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof state } catch {}
    if (state[key] !== 'sent') state[key] = result
    saveIncidentDeliveryState(file, state)
  }
  for (const { channel, outcome } of channels.filter(item => item.outcome === 'configuration_error')) {
    const key = `${incident.id}:${incident.reopenedAt ?? 'original'}:${notificationKey}:${channel}`
    if (state[key] === 'skipped') continue
    appendAudit({ actor: 'notifier', action: 'incident.notify', resource: 'incident', resourceId: incident.id, success: false, details: { channel, notificationKey, result: 'configuration_error' } })
    state[key] = 'skipped'
    saveIncidentDeliveryState(file, state)
  }
  if (!channels.some(channel => channel.outcome === 'sent') ||
      channels.some(channel => channel.outcome === 'configuration_error' || channel.outcome === 'failed')) complete = false
  return { complete, channels }
}

export async function notifyIncident(
  incident: Incident,
  targets: Pick<RoutingRule, 'notifySlack' | 'notifyTeams' | 'notifyWebhook' | 'notifyOncall' | 'notifyEmails'>,
  notificationKey = 'initial',
  message = `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}\nIncident: ${incident.id}\nDatabase: ${incident.dbName}\nCategory: ${incident.category}\nStatus: ${incident.status}`,
): Promise<boolean> {
  return (await notifyIncidentDetailed(incident, targets, notificationKey, message)).complete
}
