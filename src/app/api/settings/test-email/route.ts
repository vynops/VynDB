import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { sendEmail } from '@/lib/notifier'

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { to } = await req.json() as { to?: string }
  if (!to) return NextResponse.json({ error: 'Recipient email (to) is required' }, { status: 400 })
  try {
    await sendEmail([to], '[VynDB] Test email from VynDB Notifications', `This is a test email from VynDB.\n\nIf you received this, your SMTP configuration is working correctly.\n\nSent: ${new Date().toISOString()}`)
    return NextResponse.json({ ok: true, message: `Test email sent to ${to}` })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
