import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { findUserById } from './user-store'

export interface SessionPayload {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  mustChangePassword?: boolean
  iat?: number
  exp?: number
}

const ROLE_ORDER: Record<string, number> = { viewer: 0, editor: 1, admin: 2 }

function getSecret(): Uint8Array {
  const secret = process.env.VYNDB_SECRET
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error('VYNDB_SECRET must be configured with at least 32 bytes')
  }
  return new TextEncoder().encode(secret)
}

export function sessionCookieName(): string {
  return 'vyndb_session'
}

export async function createSession(
  payload: Pick<SessionPayload, 'id' | 'email' | 'name' | 'role' | 'mustChangePassword'>
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret())
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(sessionCookieName())?.value
  if (!token) return null
  const session = await verifySession(token)
  if (!session) return null
  const user = findUserById(session.id)
  return user?.active ? { ...session, mustChangePassword: user.mustChangePassword === true } : null
}

export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionPayload | null> {
  const token = req.cookies.get(sessionCookieName())?.value
  if (!token) return null
  const session = await verifySession(token)
  if (!session) return null
  const user = findUserById(session.id)
  return user?.active ? { ...session, mustChangePassword: user.mustChangePassword === true } : null
}

export function hasRole(
  session: SessionPayload,
  minimum: 'viewer' | 'editor' | 'admin'
): boolean {
  return (ROLE_ORDER[session.role] ?? -1) >= (ROLE_ORDER[minimum] ?? 99)
}

export async function requireRole(
  req: NextRequest,
  minimum: 'viewer' | 'editor' | 'admin'
): Promise<SessionPayload | NextResponse> {
  const session = await getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.mustChangePassword) {
    return NextResponse.json({ error: 'Password change required' }, { status: 403 })
  }
  if (!hasRole(session, minimum)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}
