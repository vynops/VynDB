import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings, saveSettings } from '@/lib/settings-store'
import { appendAudit } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const s = getSettings()
  const secretKeys = [
    'aiApiKey', 'groqApiKey', 'slackWebhookUrl', 'teamsWebhookUrl', 'customWebhookUrl',
    'smtpPassword', 'graphqlAuthToken',
  ] as const
  const maskedSecrets = Object.fromEntries(secretKeys.map(key => [key, s[key] ? '***configured***' : '']))
  return NextResponse.json({
    ...s,
    ...maskedSecrets,
  })
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const numericLimits: Record<string, { min: number; max: number }> = {
    slowQueryThresholdMs: { min: 1, max: 86_400_000 },
    replicationLagAlertSec: { min: 1, max: 86_400 },
    connectionPoolPctAlert: { min: 1, max: 100 },
    backupRpoBreachAlertHrs: { min: 1, max: 8_760 },
    notifyCooldownMinutes: { min: 0, max: 1_440 },
    defaultRefreshInterval: { min: 5, max: 3_600 },
  }
  for (const [key, limits] of Object.entries(numericLimits)) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < limits.min || body[key] > limits.max) {
      return NextResponse.json({ error: `${key} must be a number between ${limits.min} and ${limits.max}` }, { status: 400 })
    }
  }
  const keepAiApiKey = body.aiApiKey === '***configured***'
  const existing = getSettings()
  const secretKeys = [
    'aiApiKey', 'groqApiKey', 'slackWebhookUrl', 'teamsWebhookUrl', 'customWebhookUrl',
    'smtpPassword', 'graphqlAuthToken',
  ] as const
  for (const key of secretKeys) {
    if (body[key] === '***configured***') body[key] = existing[key]
  }
  // For backward compatibility: if aiApiKey is set, update groqApiKey too
  if (body.aiProvider === 'groq' && body.aiApiKey && !keepAiApiKey) {
    body.groqApiKey = body.aiApiKey
  }
  saveSettings(body)
  appendAudit({ actor: auth.email, action: 'settings.update', resource: 'settings', success: true, details: { keys: Object.keys(body).filter(key => !/key|password|token/i.test(key)) } })
  return NextResponse.json({ ok: true })
}
