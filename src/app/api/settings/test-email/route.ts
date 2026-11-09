import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { sendEmail } from '@/lib/notifier'

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { to } = await req.json() as { to?: string }
  if (!to) return NextResponse.json({ error: 'Recipient email (to) is required' }, { status: 400 })
  try {
    const result = await sendEmail([to], '[VynDB] Test email from VynDB Notifications', `This is a test email from VynDB.\n\nIf you received this, your SMTP configuration is working correctly.\n\nSent: ${new Date().toISOString()}`)
    if (result === 'sent') return NextResponse.json({ ok: true, message: `Test email sent to ${to}` })
    if (result === 'skipped') return NextResponse.json({ ok: false, message: 'Email test skipped: enable email alerts and configure SMTP.' }, { status: 503 })
    return NextResponse.json({ ok: false, message: 'Email test failed. Check SMTP settings and notification logs.' }, { status: 502 })
  } catch {
    return NextResponse.json({ ok: false, message: 'Email test failed unexpectedly.' }, { status: 500 })
  }
}
