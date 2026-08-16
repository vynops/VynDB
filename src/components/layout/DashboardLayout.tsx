'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import Header from './Header'

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/overview':     { title: 'Overview',            subtitle: 'Database fleet health at a glance' },
  '/databases':    { title: 'Databases',           subtitle: 'Connection management & health' },
  '/queries':      { title: 'Query Analyzer',      subtitle: 'AI-powered SQL analysis & tuning' },
  '/slow-queries': { title: 'Slow Queries',        subtitle: 'Captured slow query log with AI insights' },
  '/performance':  { title: 'Performance',         subtitle: 'Real-time database metrics & charts' },
  '/schema':       { title: 'Schema Explorer',     subtitle: 'Browse tables, columns & indexes' },
  '/backups':      { title: 'Backup & Recovery',   subtitle: 'Backup jobs, RPO/RTO & PITR guidance' },
  '/replication':  { title: 'Replication & HA',    subtitle: 'Replication lag & high-availability status' },
  '/capacity':     { title: 'Capacity Analytics',  subtitle: 'Storage growth, bloat & projections' },
  '/security':     { title: 'Security & Compliance', subtitle: 'Privilege audit, CIS benchmarks & compliance' },
  '/incidents':    { title: 'Incidents',           subtitle: 'Open alerts & incident lifecycle' },
  '/oncall':       { title: 'On-Call',             subtitle: 'Shift schedule & current on-call' },
  '/routing':      { title: 'Routing & Escalations', subtitle: 'Alert routing rules & escalation policies' },
  '/sla':          { title: 'SLA Tracker',         subtitle: 'Response & resolution SLA tracking' },
  '/copilot':      { title: 'AI Copilot',          subtitle: 'Database operations copilot grounded in VynDB evidence' },
  '/team':         { title: 'Team',                subtitle: 'User management & role-based access' },
  '/settings':     { title: 'Settings',            subtitle: 'Integrations, alerts & AI configuration' },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const page = PAGE_TITLES[pathname] ?? { title: 'VynDB', subtitle: '' }

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={page.title} subtitle={page.subtitle} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
