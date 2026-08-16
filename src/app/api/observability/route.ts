import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof NextResponse) return auth
  return NextResponse.json({
    storage: { type: 'json-files', atomicWrites: true, multiInstanceSafe: false, longTermMetrics: false },
    metrics: { prometheus: true, endpoint: '/api/metrics', tokenRequired: true },
    tracing: { opentelemetry: false, requestCorrelation: true, note: 'Install and configure an OpenTelemetry exporter before enabling distributed tracing.' },
    retention: { performanceSnapshotsPerDatabase: 48, slowQueries: 200, auditEntries: 10000, notificationEntries: 1000 },
  })
}