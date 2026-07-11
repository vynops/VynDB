import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRules } from '@/lib/automation-store'
import { loadRuns } from '@/lib/automation-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  const { searchParams } = new URL(req.url)
  const ruleId = searchParams.get('ruleId')
  const runs = loadRuns()
  return NextResponse.json(ruleId ? runs.filter(r => r.ruleId === ruleId) : runs)
}
