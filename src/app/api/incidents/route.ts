import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadIncidents, addIncident } from '@/lib/incident-store'
import { sendSlack, sendTeams, sendWebhook, sendEmail } from '@/lib/notifier'
import { matchRouting, currentOnCallEmails, findOpenIncidentDuplicate } from '@/lib/incident-store'
import { getSettings } from '@/lib/settings-store'
import { appendAudit } from '@/lib/audit-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const list = loadIncidents()
  return NextResponse.json(status ? list.filter(i => i.status === status) : list)
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  if (typeof body.title !== 'string' || !body.title.trim() || !['critical', 'high', 'medium', 'low'].includes(body.severity) || !['performance', 'availability', 'replication', 'backup', 'security', 'capacity', 'other'].includes(body.category)) {
    return NextResponse.json({ error: 'Valid title, severity, and category are required' }, { status: 400 })
  }
  const duplicate = findOpenIncidentDuplicate(body)
  if (duplicate) return NextResponse.json(duplicate, { status: 200, headers: { 'X-VynDB-Deduplicated': 'true' } })
  const inc = addIncident(body)
  appendAudit({ actor: auth.email, action: 'incident.create', resource: 'incident', resourceId: inc.id, success: true, details: { source: inc.source, severity: inc.severity, category: inc.category } })

  // Fire notifications
  const rule = matchRouting(inc.severity, inc.category)
  const settings = getSettings()
  const teamLine = settings.notificationTeam ? `\nTeam: ${settings.notificationTeam}` : ''
  const msg = `[VynDB ${inc.severity.toUpperCase()}] ${inc.title}\nDatabase: ${inc.dbName}\nCategory: ${inc.category}${teamLine}\nTime: ${new Date().toISOString()}`

  if (rule.notifySlack) sendSlack(msg).catch(() => {})
  if (rule.notifyTeams) sendTeams(msg).catch(() => {})
  if (rule.notifyWebhook) sendWebhook({
    alert_type: 'incident',
    title: inc.title,
    severity: inc.severity,
    database: inc.dbName,
    category: inc.category,
    team: settings.notificationTeam || undefined,
    timestamp: new Date().toISOString(),
    message: msg,
  }).catch(() => {})

  const emails: string[] = [...rule.notifyEmails]
  if (rule.notifyOncall) emails.push(...currentOnCallEmails())
  if (settings.alertRecipients) emails.push(...settings.alertRecipients.split(',').map(e => e.trim()).filter(Boolean))
  const uniqueEmails = [...new Set(emails)]
  if (uniqueEmails.length > 0) sendEmail(uniqueEmails, `[VynDB ${inc.severity.toUpperCase()}] ${inc.title}`, msg).catch(() => {})

  return NextResponse.json(inc, { status: 201 })
}
