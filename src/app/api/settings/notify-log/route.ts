import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const file = path.join(process.cwd(), 'data', 'notification-log.json')
  if (!fs.existsSync(file)) return NextResponse.json({ entries: [] })
  try { return NextResponse.json({ entries: JSON.parse(fs.readFileSync(file, 'utf8')) }) }
  catch { return NextResponse.json({ entries: [] }) }
}