import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { updateUser, deleteUser, findUserById } from '@/lib/user-store'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const body = await req.json()
  const user = findUserById(id)
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const updated = updateUser(id, body)
  if (!updated) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  return NextResponse.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  deleteUser(id)
  return NextResponse.json({ ok: true })
}
