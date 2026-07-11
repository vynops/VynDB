import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { loadRouting, saveRouting } from '@/lib/incident-store'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json(loadRouting())
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const body = await req.json()
  const rules = loadRouting()
  const rule = { id: crypto.randomUUID().slice(0, 8), name: body.name, severity: body.severity ?? '*', category: body.category ?? '*', notifyEmails: body.notifyEmails ?? [], notifySlack: body.notifySlack ?? false, notifyOncall: body.notifyOncall ?? false, escalationPolicyId: body.escalationPolicyId ?? 'default' }
  rules.push(rule)
  saveRouting(rules)
  return NextResponse.json(rule, { status: 201 })
}
