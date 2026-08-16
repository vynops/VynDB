'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(response => response.json())

export function useAppTimezone(): string {
  const { data } = useSWR<{ timezone?: string }>('/api/settings', fetcher)
  return data?.timezone || 'UTC'
}

export function formatAppDate(value: string, timezone: string, options: Intl.DateTimeFormatOptions = {}): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, ...options }).format(date)
}
