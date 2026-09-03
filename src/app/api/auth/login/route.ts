import { NextRequest, NextResponse } from 'next/server'
import { findUserByEmail, touchLastLogin, verifyPassword } from '@/lib/user-store'
import { createSession, sessionCookieName } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json() as { email: string; password: string }
  const user = findUserByEmail(email)
  if (!user || !user.active || !verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
  touchLastLogin(user.id)
  const token = await createSession({ id: user.id, email: user.email, name: user.name, role: user.role })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 86400, path: '/',
  })
  return res
}
