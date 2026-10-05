import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSettings } from './settings-store'
import { currentOnCallEmails, type Incident, type RoutingRule } from './incident-store'
import { appendAudit } from './audit-store'

const NOTIFY_STATE = path.join(process.cwd(), 'data', 'notification-state.json')
const NOTIFY_LOG = path.join(process.cwd(), 'data', 'notification-log.json')

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
  const key = `slack:${text}`
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
  const key = `teams:${text}`
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
  const key = `webhook:${serialized}`
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
  const key = `email:${[...new Set(to)].sort().join(',')}:${subject}:${body}`
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

export async function notifyIncident(
  incident: Incident,
  targets: Pick<RoutingRule, 'notifySlack' | 'notifyTeams' | 'notifyWebhook' | 'notifyOncall' | 'notifyEmails'>,
  notificationKey = 'initial',
  message = `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}\nIncident: ${incident.id}\nDatabase: ${incident.dbName}\nCategory: ${incident.category}\nStatus: ${incident.status}`,
): Promise<boolean> {
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
  const deliveries: Array<[string, () => Promise<DeliveryResult>]> = []
  if (targets.notifySlack) deliveries.push(['slack', () => sendSlack(deliveryMessage)])
  if (targets.notifyTeams) deliveries.push(['teams', () => sendTeams(deliveryMessage)])
  if (targets.notifyWebhook) deliveries.push(['webhook', () => sendWebhook({ alert_type: escalation ? 'escalation' : 'incident', incidentId: incident.id, title: incident.title, severity: incident.severity, category: incident.category, status: incident.status, database: incident.dbName, team: settings.notificationTeam || undefined, notificationKey, reopenedAt: incident.reopenedAt, message: deliveryMessage })])
  if (generalEmails.length) deliveries.push(['email', () => sendEmail(generalEmails, `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}`, deliveryMessage)])
  if (targets.notifyOncall) deliveries.push(['oncall', () => sendEmail([...new Set(oncallEmails)], `[VynDB ${incident.severity.toUpperCase()}] ${incident.title}`, deliveryMessage)])
  let complete = true
  for (const [channel, deliver] of deliveries) {
    const key = `${incident.id}:${incident.reopenedAt ?? 'original'}:${notificationKey}:${channel}`
    if (state[key] === 'sent') continue
    const result = await deliver().catch(() => 'failed' as const)
    if (result !== 'sent') complete = false
    if (result !== state[key] || result === 'failed') {
      appendAudit({ actor: 'notifier', action: 'incident.notify', resource: 'incident', resourceId: incident.id, success: result === 'sent', details: { channel, notificationKey, result } })
    }
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof state } catch {}
    if (state[key] !== 'sent') state[key] = result
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(state), 'utf8')
    fs.renameSync(temp, file)
  }
  return complete
}
