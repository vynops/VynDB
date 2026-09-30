import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const DIR = path.join(process.cwd(), 'data', 'execution-claims')

export interface ExecutionClaim {
  id: string
  key: string
  state: 'running' | 'completed' | 'unverified'
  startedAt: string
  completedAt?: string
  outcome?: string
}

function fileFor(key: string): string {
  return path.join(DIR, `${crypto.createHash('sha256').update(key).digest('hex')}.json`)
}

export function claimExecution(key: string): { claimed: boolean; record: ExecutionClaim } {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const file = fileFor(key)
  const record: ExecutionClaim = { id: crypto.randomUUID(), key, state: 'running', startedAt: new Date().toISOString() }
  try {
    fs.writeFileSync(file, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    return { claimed: true, record }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return { claimed: false, record: JSON.parse(fs.readFileSync(file, 'utf8')) as ExecutionClaim }
  }
}

export function finishExecution(record: ExecutionClaim, outcome: string, uncertain = false): void {
  const file = fileFor(record.key)
  const updated: ExecutionClaim = { ...record, state: uncertain ? 'unverified' : 'completed', completedAt: new Date().toISOString(), outcome }
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(updated), { mode: 0o600 })
  fs.renameSync(temp, file)
}

export function releaseExecution(record: ExecutionClaim): void {
  const file = fileFor(record.key)
  const current = JSON.parse(fs.readFileSync(file, 'utf8')) as ExecutionClaim
  if (current.id !== record.id || current.state === 'running' || current.state === 'unverified') {
    throw new Error('Execution outcome must be resolved before releasing the claim')
  }
  fs.unlinkSync(file)
}

export function resolveRuleLock(ruleId: string, note: string): ExecutionClaim | null {
  const file = fileFor(`rule-lock:${ruleId}`)
  if (!fs.existsSync(file)) return null
  const record = JSON.parse(fs.readFileSync(file, 'utf8')) as ExecutionClaim
  if (record.state === 'running' && Date.now() - new Date(record.startedAt).getTime() < 10 * 60_000) {
    throw new Error('The execution may still be running; wait at least ten minutes before resolving the lock')
  }
  if (record.state === 'completed') throw new Error('The lock is already completed')
  finishExecution(record, `Manually investigated: ${note}`)
  releaseExecution(record)
  return record
}