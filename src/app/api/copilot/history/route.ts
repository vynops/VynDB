import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const FILE = path.join(process.cwd(), 'data', 'copilot-history.json')
const MAX_SESSIONS = 50

export interface CopilotSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: { role: 'user' | 'assistant'; content: string; ts: number }[]
}

function load(): CopilotSession[] {
  if (!fs.existsSync(FILE)) return []
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return [] }
}

function save(sessions: CopilotSession[]) {
  const dir = path.dirname(FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(sessions, null, 2), 'utf8')
}

// GET /api/copilot/history         — list (no message bodies)
// GET /api/copilot/history?id=xxx  — single session with messages
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth

  const id = new URL(req.url).searchParams.get('id')
  const sessions = load()

  if (id) {
    const session = sessions.find(s => s.id === id)
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(session)
  }

  // Return list without message bodies to keep response small
  return NextResponse.json(
    sessions
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
      .map(({ id, title, createdAt, updatedAt, messages }) => ({
        id, title, createdAt, updatedAt, messageCount: messages.length,
      }))
  )
}

// POST /api/copilot/history — create or update a session
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth

  const body = await req.json() as { id?: string; messages: CopilotSession['messages'] }
  if (!body.messages?.length) return NextResponse.json({ error: 'No messages' }, { status: 400 })

  const sessions = load()
  const now = new Date().toISOString()
  const title = body.messages.find(m => m.role === 'user')?.content.slice(0, 60) ?? 'Conversation'

  if (body.id) {
    const idx = sessions.findIndex(s => s.id === body.id)
    if (idx !== -1) {
      sessions[idx] = { ...sessions[idx], title, updatedAt: now, messages: body.messages }
      save(sessions)
      return NextResponse.json({ id: sessions[idx].id })
    }
  }

  // New session
  const session: CopilotSession = {
    id: `sess-${crypto.randomUUID().slice(0, 8)}`,
    title, createdAt: now, updatedAt: now,
    messages: body.messages,
  }
  sessions.unshift(session)
  save(sessions.slice(0, MAX_SESSIONS))
  return NextResponse.json({ id: session.id }, { status: 201 })
}

// DELETE /api/copilot/history?id=xxx
export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, 'viewer')
  if (auth instanceof NextResponse) return auth

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const sessions = load().filter(s => s.id !== id)
  save(sessions)
  return NextResponse.json({ ok: true })
}
