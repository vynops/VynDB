'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(response => response.json())

export function useAppRefreshInterval(fallbackSeconds: number): number {
  const { data } = useSWR<{ defaultRefreshInterval?: number }>('/api/settings', fetcher)
  const seconds = Number(data?.defaultRefreshInterval ?? fallbackSeconds)
  return (Number.isFinite(seconds) ? Math.min(3600, Math.max(5, seconds)) : fallbackSeconds) * 1000
}
