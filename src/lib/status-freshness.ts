export const STATUS_STALE_MS = 15 * 60_000

export function isStatusStale(lastChecked: string, now = Date.now()): boolean {
  const checkedAt = Date.parse(lastChecked)
  return !Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > STATUS_STALE_MS
}