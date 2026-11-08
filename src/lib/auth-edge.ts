import { jwtVerify } from 'jose'
import { NextRequest } from 'next/server'

function getSecret(): Uint8Array {
  const secret = process.env.VYNDB_SECRET
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error('VYNDB_SECRET must be configured with at least 32 bytes')
  }
  return new TextEncoder().encode(secret)
}

export async function getSessionState(req: NextRequest): Promise<{ mustChangePassword: boolean } | null> {
  const token = req.cookies.get('vyndb_session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return { mustChangePassword: payload.mustChangePassword === true }
  } catch {
    return null
  }
}