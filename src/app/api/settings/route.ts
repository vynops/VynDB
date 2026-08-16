import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings, saveSettings } from '@/lib/settings-store'
import { appendAudit } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const s = getSettings()
  // Don't expose the raw API keys in viewer-level calls
  return NextResponse.json({
    ...s,
    aiApiKey: s.aiApiKey ? '***configured***' : '',
    groqApiKey: s.groqApiKey ? '***configured***' : '',
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
  // If caller sends '***configured***' back, keep existing keys
  if (body.aiApiKey === '***configured***') {
    const existing = getSettings()
    body.aiApiKey = existing.aiApiKey
  }
  if (body.groqApiKey === '***configured***') {
    const existing = getSettings()
    body.groqApiKey = existing.groqApiKey
  }
  // For backward compatibility: if aiApiKey is set, update groqApiKey too
  if (body.aiProvider === 'groq' && body.aiApiKey && body.aiApiKey !== '***configured***') {
    body.groqApiKey = body.aiApiKey
  }
  saveSettings(body)
  appendAudit({ actor: auth.email, action: 'settings.update', resource: 'settings', success: true, details: { keys: Object.keys(body).filter(key => !/key|password|token/i.test(key)) } })
  return NextResponse.json({ ok: true })
}
