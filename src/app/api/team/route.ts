import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { listUsers, createUser } from '@/lib/user-store'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const users = listUsers().map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, lastLogin: u.lastLogin, createdAt: u.createdAt }))
  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { email, name, role, password } = await req.json()
  if (!email || !name || !role || !password) {
    return NextResponse.json({ error: 'email, name, role and password are required' }, { status: 400 })
  }
  const u = createUser({ email, name, role, password })
  return NextResponse.json({ id: u.id, email: u.email, name: u.name, role: u.role }, { status: 201 })
}
