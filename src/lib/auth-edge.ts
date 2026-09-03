import { jwtVerify } from 'jose'
import { NextRequest } from 'next/server'

function getSecret(): Uint8Array {
  return new TextEncoder().encode(
    process.env.VYNDB_SECRET ?? 'vyndb-fallback-dev-secret-change-in-prod'
  )
}

export async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('vyndb_session')?.value
  if (!token) return false
  try {
    await jwtVerify(token, getSecret())
    return true
  } catch {
    return false
  }
}