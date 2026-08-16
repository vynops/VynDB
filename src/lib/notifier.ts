import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getSettings } from './settings-store'

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

export async function sendSlack(text: string): Promise<void> {
  const { slackWebhookUrl } = getSettings()
  if (!slackWebhookUrl) return
  if (!claimNotification(`slack:${text}`)) return
  try {
    const res = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    logDelivery('slack', res.ok, res.ok ? 'delivered' : `HTTP ${res.status}`)
    if (!res.ok) console.error('[vyndb:notifier] Slack webhook failed:', res.status)
  } catch (e) {
    logDelivery('slack', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Slack error:', e)
  }
}

export async function sendTeams(text: string): Promise<void> {
  const { teamsWebhookUrl } = getSettings()
  if (!teamsWebhookUrl) return
  if (!claimNotification(`teams:${text}`)) return
  try {
    const res = await fetch(teamsWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: text,
        text,
      }),
    })
    logDelivery('teams', res.ok, res.ok ? 'delivered' : `HTTP ${res.status}`)
    if (!res.ok) console.error('[vyndb:notifier] Teams webhook failed:', res.status)
  } catch (e) {
    logDelivery('teams', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Teams error:', e)
  }
}

export async function sendWebhook(payload: Record<string, unknown>): Promise<void> {
  const { customWebhookUrl } = getSettings()
  if (!customWebhookUrl) return
  const serialized = JSON.stringify(payload)
  if (!claimNotification(`webhook:${serialized}`)) return
  try {
    const res = await fetch(customWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    logDelivery('webhook', res.ok, res.ok ? 'delivered' : `HTTP ${res.status}`)
    if (!res.ok) console.error('[vyndb:notifier] Custom webhook failed:', res.status)
  } catch (e) {
    logDelivery('webhook', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Custom webhook error:', e)
  }
}

export async function sendEmail(to: string[], subject: string, body: string): Promise<void> {
  const s = getSettings()
  if (!s.alertEmailEnabled || !s.smtpHost || to.length === 0) return
  if (!claimNotification(`email:${subject}:${body}`)) return
  try {
    const transporter = nodemailer.createTransport({
      host: s.smtpHost,
      port: s.smtpPort || 587,
      secure: s.smtpPort === 465,
      auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword } : undefined,
      tls: { rejectUnauthorized: false },
    })
    await transporter.sendMail({
      from: s.smtpFrom || s.smtpUser,
      to: to.join(', '),
      subject,
      text: body,
      html: `<pre style="font-family:monospace;font-size:13px">${body.replace(/</g, '&lt;')}</pre>`,
    })
    logDelivery('email', true, `delivered to ${to.length} recipient(s)`)
  } catch (e) {
    logDelivery('email', false, e instanceof Error ? e.message : String(e))
    console.error('[vyndb:notifier] Email error:', e)
  }
}
