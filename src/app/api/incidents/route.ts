import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadIncidents, addIncident } from '@/lib/incident-store'
import { sendSlack, sendEmail } from '@/lib/notifier'
import { matchRouting, currentOnCallEmails } from '@/lib/incident-store'
import { getSettings } from '@/lib/settings-store'

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
  const inc = addIncident(body)

  // Fire notifications
  const rule = matchRouting(inc.severity, inc.category)
  const settings = getSettings()
  const msg = `[VynDB ${inc.severity.toUpperCase()}] ${inc.title}\nDatabase: ${inc.dbName}\nCategory: ${inc.category}\nTime: ${new Date().toISOString()}`

  if (rule.notifySlack) sendSlack(msg).catch(() => {})

  const emails: string[] = [...rule.notifyEmails]
  if (rule.notifyOncall) emails.push(...currentOnCallEmails())
  if (settings.alertRecipients) emails.push(...settings.alertRecipients.split(',').map(e => e.trim()).filter(Boolean))
  const uniqueEmails = [...new Set(emails)]
  if (uniqueEmails.length > 0) sendEmail(uniqueEmails, `[VynDB ${inc.severity.toUpperCase()}] ${inc.title}`, msg).catch(() => {})

  return NextResponse.json(inc, { status: 201 })
}
