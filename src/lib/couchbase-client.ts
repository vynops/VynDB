import type { DbConnection } from './db-store'

export class CouchbaseApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'CouchbaseApiError'
  }
}

function managementPort(db: DbConnection): number {
  if (db.ssl && db.port === 8091) return 18091
  if (!db.ssl && db.port === 18091) return 8091
  return db.port
}

function queryPort(db: DbConnection): number {
  const port = managementPort(db)
  if (port === 8091) return 8093
  if (port === 18091) return 18093
  return port + 2
}

function baseUrl(db: DbConnection, port: number): string {
  return `${db.ssl ? 'https' : 'http'}://${db.host}:${port}`
}

function authHeaders(db: DbConnection): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (db.username) {
    headers.Authorization = `Basic ${Buffer.from(`${db.username}:${db.passwordEnc}`).toString('base64')}`
  }
  return headers
}

export async function couchbaseJson<T>(
  db: DbConnection,
  apiPath: string,
  options: RequestInit = {},
  queryService = false,
): Promise<T> {
  const port = queryService ? queryPort(db) : managementPort(db)
  const headers = { ...authHeaders(db), ...options.headers }
  const response = await fetch(`${baseUrl(db, port)}${apiPath}`, {
    ...options,
    headers,
    signal: options.signal ?? AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new CouchbaseApiError(`Couchbase API ${apiPath} failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`, response.status)
  }
  return await response.json() as T
}

export async function runCouchbaseQuery<T>(
  db: DbConnection,
  statement: string,
  options: { timeoutMs?: number; args?: unknown[] } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000
  return couchbaseJson<T>(db, '/query/service', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement, timeout: `${timeoutMs}ms`, args: options.args }),
    signal: AbortSignal.timeout(timeoutMs + 2_000),
  }, true)
}
