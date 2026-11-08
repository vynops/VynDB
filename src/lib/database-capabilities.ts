import type { DbEngine } from './db-store'

export type CapabilityState = 'available' | 'partial' | 'requires_configuration' | 'unavailable'

export interface DatabaseCapability {
  key: 'performance' | 'slowQueries' | 'schema' | 'capacity' | 'replication' | 'security'
  label: string
  state: CapabilityState
  requirement?: string
}

const CAPABILITIES: Record<DbEngine, DatabaseCapability[]> = {
  postgresql: [
    { key: 'performance', label: 'Performance metrics', state: 'partial', requirement: 'CPU, memory, and disk I/O require host metrics.' },
    { key: 'slowQueries', label: 'Slow queries', state: 'requires_configuration', requirement: 'Enable the pg_stat_statements extension.' },
    { key: 'schema', label: 'Schema inspection', state: 'available' },
    { key: 'capacity', label: 'Capacity metrics', state: 'available' },
    { key: 'replication', label: 'Replication', state: 'partial', requirement: 'Requires access to replication and WAL views.' },
    { key: 'security', label: 'Security checks', state: 'partial', requirement: 'Role and SSL checks require catalog permissions.' },
  ],
  mysql: [
    { key: 'performance', label: 'Performance metrics', state: 'partial', requirement: 'CPU, memory, and disk I/O require host metrics.' },
    { key: 'slowQueries', label: 'Slow queries', state: 'requires_configuration', requirement: 'Enable performance_schema and statement digest collection.' },
    { key: 'schema', label: 'Schema inspection', state: 'available' },
    { key: 'capacity', label: 'Capacity metrics', state: 'available' },
    { key: 'replication', label: 'Replication', state: 'unavailable', requirement: 'MySQL replication collection is not implemented yet.' },
    { key: 'security', label: 'Security checks', state: 'partial', requirement: 'mysql system-table access is required.' },
  ],
  sqlserver: [
    { key: 'performance', label: 'Performance metrics', state: 'partial', requirement: 'CPU, memory, and disk I/O require host metrics.' },
    { key: 'slowQueries', label: 'Slow queries', state: 'requires_configuration', requirement: 'Grant VIEW SERVER STATE.' },
    { key: 'schema', label: 'Schema inspection', state: 'available' },
    { key: 'capacity', label: 'Capacity metrics', state: 'available' },
    { key: 'replication', label: 'Replication', state: 'unavailable', requirement: 'SQL Server HA collection is not implemented yet.' },
    { key: 'security', label: 'Security checks', state: 'partial', requirement: 'Catalog and server-state permissions are required.' },
  ],
  mongodb: [
    { key: 'performance', label: 'Performance metrics', state: 'partial', requirement: 'Host CPU, memory, and disk I/O are not collected.' },
    { key: 'slowQueries', label: 'Slow queries', state: 'requires_configuration', requirement: 'Enable database profiling.' },
    { key: 'schema', label: 'Schema inspection', state: 'available' },
    { key: 'capacity', label: 'Capacity metrics', state: 'available' },
    { key: 'replication', label: 'Replication', state: 'unavailable', requirement: 'Replica-set collection is not implemented yet.' },
    { key: 'security', label: 'Security checks', state: 'unavailable', requirement: 'MongoDB security collection is not implemented yet.' },
  ],
  redis: [
    { key: 'performance', label: 'Performance metrics', state: 'partial', requirement: 'CPU and disk I/O are not collected.' },
    { key: 'slowQueries', label: 'Slow queries', state: 'requires_configuration', requirement: 'Redis SLOWLOG must be enabled and accessible.' },
    { key: 'schema', label: 'Schema inspection', state: 'unavailable', requirement: 'Redis has no relational schema.' },
    { key: 'capacity', label: 'Capacity metrics', state: 'partial', requirement: 'Memory capacity depends on maxmemory configuration.' },
    { key: 'replication', label: 'Replication', state: 'unavailable', requirement: 'Redis replication and Sentinel collection is not implemented yet.' },
    { key: 'security', label: 'Security checks', state: 'partial', requirement: 'Basic configuration checks only.' },
  ],
  couchbase: [
    { key: 'performance', label: 'Performance metrics', state: 'partial', requirement: 'Management API probe latency, node CPU/memory, connections, operations, and bucket capacity are collected; host disk I/O, cache hit, max connections, and p95/p99 latency are unavailable.' },
    { key: 'slowQueries', label: 'Slow queries', state: 'requires_configuration', requirement: 'Query Service completed-request access requires Query Manage privileges.' },
    { key: 'schema', label: 'Schema inspection', state: 'partial', requirement: 'Scopes, collections, inferred fields, and GSI metadata are best-effort; exact row counts and per-collection sizes are not collected.' },
    { key: 'capacity', label: 'Capacity metrics', state: 'partial', requirement: 'Cluster disk and bucket data sizes are collected; index split and bloat are unavailable.' },
    { key: 'replication', label: 'Replication', state: 'partial', requirement: 'XDCR task state and changes remaining are reported; time-based lag is not available.' },
    { key: 'security', label: 'Security checks', state: 'partial' },
  ],
}

export function getDatabaseCapabilities(engine: DbEngine): DatabaseCapability[] {
  return CAPABILITIES[engine].map(capability => ({ ...capability }))
}