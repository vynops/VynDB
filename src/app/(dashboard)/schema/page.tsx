'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { ChevronRight, Table2, Search, Database, Hash, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface Column { name: string; type: string; nullable: boolean; default?: string }
interface Index { name: string; columns: string[] | string; unique: boolean; type: string }
function parseCols(cols: string[] | string): string[] {
  if (Array.isArray(cols)) return cols
  // PostgreSQL array literal: "{col1,col2}" → ["col1","col2"]
  return String(cols).replace(/^\{|\}$/g, '').split(',').filter(Boolean)
}
interface TableRow {
  dbId: string; schema: string; name: string; engine: string;
  rowCount: number; sizeMB: number; indexSizeMB: number;
  columns: Column[]; indexes: Index[]; lastAnalyzed?: string
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export default function SchemaPage() {
  const { data: dbs } = useSWR('/api/databases', fetcher)
  const { data: schema } = useSWR('/api/schema', fetcher)

  const dbList = Array.isArray(dbs) ? dbs : []
  const tables: TableRow[] = Array.isArray(schema) ? schema : []

  const [selectedDb, setSelectedDb] = useState<string>('')
  const [selectedTable, setSelectedTable] = useState<TableRow | null>(null)
  const [search, setSearch] = useState('')

  const dbId = selectedDb || (dbList[0] as { id: string } | undefined)?.id || ''
  const filtered = tables.filter((t: TableRow) =>
    (t.dbId === dbId) && (!search || t.name.toLowerCase().includes(search.toLowerCase()) || t.schema.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select value={dbId} onChange={e => { setSelectedDb(e.target.value); setSelectedTable(null) }}
          className="px-3 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-slate-300">
          {dbList.map((d: { id: string; name: string }) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tables..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#0f1629] border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/60" />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Table list */}
        <div className="rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-xs font-bold text-slate-400 uppercase">Tables ({filtered.length})</h3>
          </div>
          <div className="divide-y divide-slate-800/60 max-h-[60vh] overflow-y-auto">
            {filtered.map(t => (
              <button key={`${t.schema}.${t.name}`} onClick={() => setSelectedTable(t)}
                className={cn('w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors text-left',
                  selectedTable?.name === t.name && selectedTable?.schema === t.schema && 'bg-emerald-500/10 border-l-2 border-emerald-500')}>
                <Table2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{t.name}</div>
                  <div className="text-[10px] text-slate-500">{t.schema} · {t.rowCount.toLocaleString()} rows · {formatMB(t.sizeMB)}</div>
                </div>
                <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                {tables.filter(t => t.dbId === dbId).length === 0
                  ? 'Schema not loaded for this database. Connect and enable schema introspection.'
                  : 'No matching tables'}
              </div>
            )}
          </div>
        </div>

        {/* Table detail */}
        <div className="lg:col-span-2 rounded-2xl bg-[#0f1629] border border-slate-800 overflow-hidden">
          {!selectedTable ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-2">
              <Table2 className="w-10 h-10 opacity-30" />
              <p className="text-sm">Select a table to view schema</p>
            </div>
          ) : (
            <div className="overflow-y-auto max-h-[70vh]">
              {/* Table header */}
              <div className="px-5 py-4 border-b border-slate-800 sticky top-0 bg-[#0f1629]">
                <div className="flex items-center gap-2 flex-wrap">
                  <Database className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-bold text-white">{selectedTable.schema}.{selectedTable.name}</span>
                  <span className="text-xs text-slate-500">{selectedTable.engine}</span>
                </div>
                <div className="flex gap-4 mt-2 text-xs text-slate-400">
                  <span>{selectedTable.rowCount.toLocaleString()} rows</span>
                  <span>Data: {formatMB(selectedTable.sizeMB)}</span>
                  <span>Indexes: {formatMB(selectedTable.indexSizeMB)}</span>
                  {selectedTable.lastAnalyzed && <span>Analyzed {new Date(selectedTable.lastAnalyzed).toLocaleDateString()}</span>}
                </div>
              </div>

              {/* Columns */}
              <div className="px-5 py-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Columns ({selectedTable.columns.length})</h4>
                <div className="rounded-xl border border-slate-700 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800/50">
                        <th className="text-left px-3 py-2 text-slate-400 font-semibold">Column</th>
                        <th className="text-left px-3 py-2 text-slate-400 font-semibold">Type</th>
                        <th className="text-left px-3 py-2 text-slate-400 font-semibold">Nullable</th>
                        <th className="text-left px-3 py-2 text-slate-400 font-semibold hidden sm:table-cell">Default</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {selectedTable.columns.map(col => (
                        <tr key={col.name} className="hover:bg-slate-800/20">
                          <td className="px-3 py-2 font-mono text-slate-200 font-medium">{col.name}</td>
                          <td className="px-3 py-2 font-mono text-blue-300">{col.type}</td>
                          <td className="px-3 py-2">
                            <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold', col.nullable ? 'bg-slate-700 text-slate-400' : 'bg-emerald-500/10 text-emerald-400')}>
                              {col.nullable ? 'NULL' : 'NOT NULL'}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-500 hidden sm:table-cell">{col.default ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Indexes */}
              {selectedTable.indexes.length > 0 && (
                <div className="px-5 pb-5">
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Indexes ({selectedTable.indexes.length})</h4>
                  <div className="space-y-2">
                    {selectedTable.indexes.map(idx => (
                      <div key={idx.name} className="flex items-start gap-3 p-3 rounded-xl bg-slate-900 border border-slate-700">
                        <Hash className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-200">{idx.name}</span>
                            {idx.unique && <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-bold">UNIQUE</span>}
                            <span className="text-[9px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-bold">{idx.type}</span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5 font-mono">({parseCols(idx.columns).join(', ')})</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
