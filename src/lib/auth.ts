import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export interface SessionPayload {
  id: string
  email: string
  name: string
  role: 'admin' | 'editor' | 'viewer'
  iat?: number
  exp?: number
}

const ROLE_ORDER: Record<string, number> = { viewer: 0, editor: 1, admin: 2 }

function getSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.VYNDB_SECRET ?? 'vyndb-fallback-dev-secret-change-in-prod'
  )
}

export function sessionCookieName(): string {
  return 'vyndb_session'
}

export async function createSession(
  payload: Pick<SessionPayload, 'id' | 'email' | 'name' | 'role'>
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
  return verifySession(token)
}

export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionPayload | null> {
  const token = req.cookies.get(sessionCookieName())?.value
  if (!token) return null
  return verifySession(token)
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
  if (!hasRole(session, minimum)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}
