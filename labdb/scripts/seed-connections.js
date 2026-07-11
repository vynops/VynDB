#!/usr/bin/env node
// Writes lab DB connections to data/databases.json
// Usage: node seed-connections.js /path/to/vyndb
const fs = require('fs')
const path = require('path')

const vyndbDir = process.argv[2] || '/home/vyndb/vyndb'
const dataDir  = path.join(vyndbDir, 'data')
const outFile  = path.join(dataDir, 'databases.json')

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

const now = new Date().toISOString()
const labConnections = [
  {
    id: 'db-lab-pg-primary', name: 'labdb-postgres', engine: 'postgresql',
    host: 'localhost', port: 5432, database: 'labdb', username: 'labdb',
    passwordEnc: 'labdb_P@ss2024', ssl: false, environment: 'development',
    status: 'unknown', healthScore: 0, lastChecked: now,
    version: 'PostgreSQL 16', notes: 'Lab primary — VynDB demo data',
    createdAt: now,
  },
  {
    id: 'db-lab-pg-replica', name: 'labdb-postgres-replica', engine: 'postgresql',
    host: 'localhost', port: 5433, database: 'labdb', username: 'labdb',
    passwordEnc: 'labdb_P@ss2024', ssl: false, environment: 'development',
    status: 'unknown', healthScore: 0, lastChecked: now,
    version: 'PostgreSQL 16', notes: 'Lab streaming replica (hot standby)',
    createdAt: now,
  },
  {
    id: 'db-lab-mysql', name: 'labdb-mysql', engine: 'mysql',
    host: 'localhost', port: 3306, database: 'labdb', username: 'labdb',
    passwordEnc: 'labdb_P@ss2024', ssl: false, environment: 'development',
    status: 'unknown', healthScore: 0, lastChecked: now,
    version: 'MySQL 8.0', notes: 'Lab MySQL — slow query log enabled',
    createdAt: now,
  },
  {
    id: 'db-lab-mongodb', name: 'labdb-mongodb', engine: 'mongodb',
    host: 'localhost', port: 27017, database: 'labdb', username: 'labdb',
    passwordEnc: 'labdb_P@ss2024', ssl: false, environment: 'development',
    status: 'unknown', healthScore: 0, lastChecked: now,
    version: 'MongoDB 7', notes: 'Lab MongoDB — profiling level 1',
    createdAt: now,
  },
  {
    id: 'db-lab-redis', name: 'labdb-redis', engine: 'redis',
    host: 'localhost', port: 6379, database: '0', username: '',
    passwordEnc: '', ssl: false, environment: 'development',
    status: 'unknown', healthScore: 0, lastChecked: now,
    version: 'Redis 7', notes: 'Lab Redis — slowlog enabled',
    createdAt: now,
  },
  {
    id: 'db-lab-sqlserver', name: 'labdb-sqlserver', engine: 'sqlserver',
    host: 'localhost', port: 1433, database: 'labdb', username: 'labdb',
    passwordEnc: 'labdb_P@ss2024', ssl: false, environment: 'development',
    status: 'unknown', healthScore: 0, lastChecked: now,
    version: 'SQL Server 2022', notes: 'Lab SQL Server — Developer Edition',
    createdAt: now,
  },
]

fs.writeFileSync(outFile, JSON.stringify(labConnections, null, 2), 'utf8')
console.log(`Seeded ${labConnections.length} lab connections to ${outFile}`)
