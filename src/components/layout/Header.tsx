'use client'

import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, RefreshCw, LogOut } from 'lucide-react'
import { useAppRefreshInterval } from '@/lib/use-app-refresh-interval'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const refreshInterval = useAppRefreshInterval(30)
  const { data: incidents } = useSWR('/api/incidents?status=open', fetcher, { refreshInterval })
  const openCount = Array.isArray(incidents) ? incidents.length : 0
  const router = useRouter()

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

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
        <Link href="/incidents" className="relative p-2 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors" title="Incidents">
          <Bell size={15} />
          {openCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </Link>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
          title="Log out">
          <LogOut size={15} />
          <span className="text-sm font-medium">Databases</span>
        </button>
      </div>
    </header>
  )
}

