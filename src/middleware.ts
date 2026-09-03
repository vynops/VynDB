import { NextRequest, NextResponse } from 'next/server'
import { hasValidSession } from '@/lib/auth-edge'

const PUBLIC_PATHS = ['/login', '/api/auth/login']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const requestId = req.headers.get('x-request-id') ?? globalThis.crypto.randomUUID()
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    const response = NextResponse.next()
    response.headers.set('x-request-id', requestId)
    return response
  }
  if (pathname.startsWith('/api/')) {
    // API routes are protected per-route with requireRole
    const response = NextResponse.next()
    response.headers.set('x-request-id', requestId)
    return response
  }
  if (!await hasValidSession(req)) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    const response = NextResponse.redirect(url)
    response.headers.set('x-request-id', requestId)
    return response
  }
  const response = NextResponse.next()
  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png).*)'],
}
