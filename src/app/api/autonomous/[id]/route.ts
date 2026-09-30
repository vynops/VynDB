import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({ error: 'Auto-execution is unavailable; proposals require operator approval.' }, { status: 410 })
}
