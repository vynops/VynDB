import fs from 'fs'
import path from 'path'

export interface UsageEntry {
  date: string   // YYYY-MM-DD
  requests: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  model: string
}

const DATA_DIR = path.join(process.cwd(), 'data')
const USAGE_FILE = path.join(DATA_DIR, 'copilot-usage.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function loadAll(): UsageEntry[] {
  ensureDir()
  if (!fs.existsSync(USAGE_FILE)) return []
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) as UsageEntry[] } catch { return [] }
}

export function recordUsage(promptTokens: number, completionTokens: number, model: string): void {
  const all = loadAll()
  const date = new Date().toISOString().slice(0, 10)
  const existing = all.find(e => e.date === date && e.model === model)
  if (existing) {
    existing.requests += 1
    existing.promptTokens += promptTokens
    existing.completionTokens += completionTokens
    existing.totalTokens += promptTokens + completionTokens
  } else {
    all.push({ date, requests: 1, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, model })
  }
  ensureDir()
  fs.writeFileSync(USAGE_FILE, JSON.stringify(all, null, 2), 'utf8')
}

export function getUsageSummary(): {
  today: UsageEntry | null
  last7Days: UsageEntry[]
  allTime: { requests: number; totalTokens: number }
} {
  const all = loadAll()
  const today = new Date().toISOString().slice(0, 10)
  const todayEntry = all.find(e => e.date === today) ?? null
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  const last7 = all.filter(e => e.date >= cutoff)
  const allTime = all.reduce((acc, e) => ({
    requests: acc.requests + e.requests,
    totalTokens: acc.totalTokens + e.totalTokens,
  }), { requests: 0, totalTokens: 0 })
  return { today: todayEntry, last7Days: last7, allTime }
}
