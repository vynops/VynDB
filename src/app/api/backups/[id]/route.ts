import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { deleteBackup } from '@/lib/backup-runner'
import { appendAudit } from '@/lib/audit-store'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, 'editor')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const result = deleteBackup(id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 })
  appendAudit({ actor: auth.email, action: 'backup.delete', resource: 'backup', resourceId: id, success: true, details: result })
  return NextResponse.json(result)
}
