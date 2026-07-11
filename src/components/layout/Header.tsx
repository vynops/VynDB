'use client'

import useSWR from 'swr'
import { Bell, RefreshCw } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const { data: incidents } = useSWR('/api/incidents?status=open', fetcher, { refreshInterval: 30000 })
  const openCount = Array.isArray(incidents) ? incidents.length : 0

  return (
    <header className="bg-[#0a0f1e] border-b border-slate-800/60 px-4 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
      <div className="pl-10 lg:pl-0">
        <h1 className="text-base sm:text-lg font-bold text-white leading-none">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5 hidden sm:block">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.location.reload()}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
          title="Refresh">
          <RefreshCw size={15} />
        </button>
        <button className="relative p-2 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors" title="Incidents">
          <Bell size={15} />
          {openCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>
      </div>
    </header>
  )
}
