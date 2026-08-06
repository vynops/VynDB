import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'VynDB - VynOps Suite',
  description: 'Unified database monitoring, AI query analysis, incident management, and operations across PostgreSQL, MySQL, Oracle, SQL Server, MongoDB, Redis, and CouchBase.',
  icons: { icon: '/favicon-circle.png', shortcut: '/favicon-circle.png', apple: '/favicon-circle.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full bg-slate-950 text-white antialiased">{children}</body>
    </html>
  )
}

