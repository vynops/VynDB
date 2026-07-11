import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadProposals } from '@/lib/automation-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const list = loadProposals()
  return NextResponse.json(status ? list.filter(p => p.status === status) : list)
}
