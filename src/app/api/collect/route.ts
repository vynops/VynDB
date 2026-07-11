import { NextRequest, NextResponse } from 'next/server'
import { runAllCollectors } from '@/lib/collectors'

const COLLECTOR_TOKEN = process.env.VYNDB_COLLECTOR_TOKEN ?? 'vyndb_collector_token_lab_2024'

export async function POST(req: NextRequest) {
  // Accept token via Authorization header or query param
  const auth = req.headers.get('authorization') ?? ''
  const queryToken = new URL(req.url).searchParams.get('token') ?? ''
  const provided = auth.replace('Bearer ', '').trim() || queryToken

  if (provided !== COLLECTOR_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runAllCollectors()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

// Also allow GET for quick health/last-run check
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const provided = auth.replace('Bearer ', '').trim()
  if (provided !== COLLECTOR_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, message: 'Collector ready. POST to trigger.' })
}
