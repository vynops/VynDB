import { NextRequest, NextResponse } from 'next/server'
import { runMonitor } from '@/lib/monitor'

const COLLECTOR_TOKEN = process.env.VYNDB_COLLECTOR_TOKEN ?? ''

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const queryToken = new URL(req.url).searchParams.get('token') ?? ''
  const provided = auth.replace('Bearer ', '').trim() || queryToken

  if (!COLLECTOR_TOKEN || provided !== COLLECTOR_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runMonitor()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
