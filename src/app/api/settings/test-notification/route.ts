import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getSettings } from '@/lib/settings-store'

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRole(req, 'admin')
    if (auth instanceof NextResponse) return auth

    const { channel, url: requestedUrl } = await req.json() as { channel?: string; url?: string }
    if (!channel) return NextResponse.json({ ok: false, message: 'Missing channel' }, { status: 400 })
    const configuredUrls = {
      slackWebhookUrl: getSettings().slackWebhookUrl,
      teamsWebhookUrl: getSettings().teamsWebhookUrl,
      customWebhookUrl: getSettings().customWebhookUrl,
    }
    if (!Object.hasOwn(configuredUrls, channel)) return NextResponse.json({ ok: false, message: `Unknown channel: ${channel}` }, { status: 400 })
    const url = requestedUrl === '***configured***'
      ? configuredUrls[channel as keyof typeof configuredUrls]
      : requestedUrl
    if (!url) return NextResponse.json({ ok: false, message: 'Missing channel URL' }, { status: 400 })

    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ ok: false, message: 'URL must use HTTP or HTTPS' }, { status: 400 })
    }

    const start = Date.now()
    let payload: Record<string, unknown>
    let label: string
    if (channel === 'slackWebhookUrl') {
      label = 'Slack webhook'
      payload = { text: 'VynDB test notification from Settings' }
    } else if (channel === 'teamsWebhookUrl') {
      label = 'Teams webhook'
      payload = {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: 'VynDB Test Notification',
        text: 'VynDB test notification from Settings',
      }
    } else if (channel === 'customWebhookUrl') {
      label = 'Custom webhook'
      payload = {
        alert_type: 'test',
        title: 'VynDB Test Notification',
        description: 'Test notification from VynDB Settings',
        severity: 'info',
        timestamp: new Date().toISOString(),
        source: 'vyndb/settings',
      }
    } else return NextResponse.json({ ok: false, message: `Unknown channel: ${channel}` }, { status: 400 })

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return NextResponse.json({ ok: false, message: `${label} failed: ${res.status} ${res.statusText}` })
    return NextResponse.json({ ok: true, message: `${label} delivered (${Date.now() - start}ms)` })
  } catch (e) {
    return NextResponse.json({ ok: false, message: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}