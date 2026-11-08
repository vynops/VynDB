import { NextRequest, NextResponse } from 'next/server'
import { getSessionState } from '@/lib/auth-edge'

const PUBLIC_PATHS = ['/login', '/api/auth/login']
const PASSWORD_CHANGE_PATH = '/change-password'
const PASSWORD_CHANGE_API_PATHS = ['/api/auth/change-password', '/api/auth/logout']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const requestId = req.headers.get('x-request-id') ?? globalThis.crypto.randomUUID()
  if (PUBLIC_PATHS.includes(pathname)) {
    const response = NextResponse.next()
    response.headers.set('x-request-id', requestId)
    return response
  }
  const session = await getSessionState(req)
  if (pathname.startsWith('/api/')) {
    // API routes are protected per-route with requireRole
    if (session?.mustChangePassword && !PASSWORD_CHANGE_API_PATHS.includes(pathname)) {
      const response = NextResponse.json({ error: 'Password change required' }, { status: 403 })
      response.headers.set('x-request-id', requestId)
      return response
    }
    const response = NextResponse.next()
    response.headers.set('x-request-id', requestId)
    return response
  }
  if (!session) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    const response = NextResponse.redirect(url)
    response.headers.set('x-request-id', requestId)
    return response
  }
  if (session.mustChangePassword && pathname !== PASSWORD_CHANGE_PATH) {
    const url = req.nextUrl.clone()
    url.pathname = PASSWORD_CHANGE_PATH
    const response = NextResponse.redirect(url)
    response.headers.set('x-request-id', requestId)
    return response
  }
  if (!session.mustChangePassword && pathname === PASSWORD_CHANGE_PATH) {
    const url = req.nextUrl.clone()
    url.pathname = '/overview'
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
