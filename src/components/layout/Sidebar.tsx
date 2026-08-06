'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import useSWR from 'swr'
import {
  LayoutDashboard, Database, Search, Zap, Activity, Table2,
  HardDrive, GitBranch, BarChart3, Shield, AlertTriangle,
  Phone, GitMerge, Timer, Bot, Users, Settings,
  LogOut, Menu, X, ChevronRight, Terminal, Brain,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Fleet',
    items: [
      { href: '/overview',  label: 'Overview',  icon: LayoutDashboard },
      { href: '/databases', label: 'Databases', icon: Database },
    ],
  },
  {
    title: 'Observe',
    items: [
      { href: '/performance',  label: 'Performance',      icon: Activity },
      { href: '/slow-queries', label: 'Slow Queries',     icon: Zap },
      { href: '/replication',  label: 'Replication & HA', icon: GitBranch },
      { href: '/capacity',     label: 'Capacity',         icon: BarChart3 },
      { href: '/schema',       label: 'Schema Explorer',  icon: Table2 },
    ],
  },
  {
    title: 'AIOps',
    items: [
      { href: '/copilot',    label: 'AI Copilot',     icon: Bot },
      { href: '/autonomous', label: 'Autonomous Ops', icon: Brain },
      { href: '/automation', label: 'Automation',     icon: Terminal },
    ],
  },
  {
    title: 'Operate',
    items: [
      { href: '/queries',    label: 'Query Analyzer', icon: Search },
      { href: '/backups',    label: 'Backups',        icon: HardDrive },
      { href: '/incidents',  label: 'Incidents',      icon: AlertTriangle },
      { href: '/oncall',     label: 'On-Call',        icon: Phone },
      { href: '/routing',    label: 'Routing',        icon: GitMerge },
      { href: '/sla',        label: 'SLA Tracker',    icon: Timer },
    ],
  },
  {
    title: 'Govern',
    items: [
      { href: '/security', label: 'Security', icon: Shield },
    ],
  },
  {
    title: 'Admin',
    items: [
      { href: '/team',     label: 'Team',     icon: Users },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const fetcher = (url: string) => fetch(url).then(r => r.json())

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const Icon = item.icon
  return (
    <Link href={item.href} onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors group',
        active
          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
      )}>
      <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300')} />
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span className="text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">{item.badge}</span>
      )}
      {active && <ChevronRight className="w-3 h-3 text-emerald-500" />}
    </Link>
  )
}

function NavSectionBlock({ section, pathname, onClose }: { section: NavSection; pathname: string; onClose?: () => void }) {
  return (
    <div className="space-y-0.5">
      <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider font-bold text-slate-600">
        {section.title}
      </div>
      {section.items.map(item => (
        <NavLink key={item.href} item={item} active={pathname === item.href} onClick={onClose} />
      ))}
    </div>
  )
}

function SidebarContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  const router = useRouter()
  const { data: me } = useSWR('/api/auth/me', fetcher)

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-800/60">
        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <Database className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-white font-bold text-base leading-none">VynDB</div>
          <div className="text-slate-500 text-xs leading-none mt-0.5">Database Ops</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-white lg:hidden">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.title}>
            {idx > 0 && <div className="border-t border-slate-800/60 my-2" />}
            <NavSectionBlock section={section} pathname={pathname} onClose={onClose} />
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-slate-800/60 p-3">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-emerald-400 text-xs font-bold">
              {me?.name ? me.name.charAt(0).toUpperCase() : '?'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-white truncate">{me?.name ?? '…'}</div>
            <div className="text-[9px] text-slate-500 uppercase font-bold truncate">{me?.role ?? ''}</div>
          </div>
          <button onClick={handleLogout} title="Sign out"
            className="p-1 rounded-lg hover:bg-slate-700 text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0">
            <LogOut size={12} />
          </button>
        </div>
        <div className="text-[10px] text-slate-700 px-2">Part of VynOps Suite</div>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:flex flex-col w-60 bg-[#0a0f1e] border-r border-slate-800/60 h-screen sticky top-0 flex-shrink-0">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Mobile hamburger */}
      <button
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white"
        onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative flex flex-col w-72 bg-[#0a0f1e] border-r border-slate-800/60 h-full overflow-y-auto">
            <SidebarContent pathname={pathname} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}

