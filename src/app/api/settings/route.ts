import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings, saveSettings } from '@/lib/settings-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const s = getSettings()
  // Don't expose the raw Groq key in viewer-level calls
  return NextResponse.json({ ...s, groqApiKey: s.groqApiKey ? '***configured***' : '' })
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  // If caller sends '***configured***' back, keep existing key
  if (body.groqApiKey === '***configured***') {
    const existing = getSettings()
    body.groqApiKey = existing.groqApiKey
  }
  saveSettings(body)
  return NextResponse.json({ ok: true })
}
