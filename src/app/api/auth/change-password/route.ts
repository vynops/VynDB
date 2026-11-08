import { NextRequest, NextResponse } from 'next/server'
import { createSession, getSessionFromRequest, sessionCookieName } from '@/lib/auth'
import { findUserById, updateUser, verifyPassword } from '@/lib/user-store'

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || !('currentPassword' in body) || !('newPassword' in body)) {
    return NextResponse.json({ error: 'Current and new passwords are required' }, { status: 400 })
  }

  const currentPassword = body.currentPassword
  const newPassword = body.newPassword
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return NextResponse.json({ error: 'Current and new passwords are required' }, { status: 400 })
  }
  if (newPassword.length < 12) {
    return NextResponse.json({ error: 'New password must be at least 12 characters' }, { status: 400 })
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: 'Choose a password different from the current password' }, { status: 400 })
  }

  const user = findUserById(session.id)
  if (!user || !user.active || !verifyPassword(currentPassword, user.passwordHash, user.passwordSalt)) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  const updated = updateUser(user.id, { password: newPassword, mustChangePassword: false })
  const token = await createSession({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    mustChangePassword: false,
  })
  const response = NextResponse.json({ ok: true })
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 86400,
    path: '/',
  })
  return response
}