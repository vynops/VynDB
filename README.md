<div align="center">

# VynDB

### AI-Powered Database Operations Platform

**Self-hosted · Open Source · Enterprise Ready**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Live Demo](https://img.shields.io/badge/Live_Demo-db.vynops.online-10b981)](https://db.vynops.online)
[![Part of VynOps](https://img.shields.io/badge/Part_of-VynOps_Suite-6366f1)](https://vynops.com)

*Monitor. Tune. Secure. Automate. All your databases from one intelligent platform.*

[**Live Demo**](https://db.vynops.online) · [**Product Page**](https://vynops.com/product/vyndb) · [**VynOps Suite**](https://vynops.com)

</div>

---

## Overview

VynDB is a production-grade, self-hosted database operations platform that brings **monitoring, AI-assisted query tuning, security auditing, backup management, incident response, and autonomous remediation** across your entire database fleet — into a single intelligent dashboard.

Built on **Next.js 16 App Router** with a lightweight JSON file store and Groq-powered AI, VynDB collects real metrics every 5 minutes from your databases using native drivers — no agents, no sidecars, no vendor lock-in.

> **Design philosophy:** VynDB does not replace your DBA team. It makes every engineer as capable as your best DBA.

---

## Screenshots

| Overview Dashboard | Database Detail | AI Copilot |
|---|---|---|
| <img width="956" height="512" alt="Screenshot 2026-09-01 152207" src="https://github.com/user-attachments/assets/e48c08d5-89c4-4750-a458-768781fb5169" />
_(screenshot)_ | _(screenshot)_ | _(screenshot)_ |


| Slow Query Analysis | Security Findings | Autonomous Proposals |
|---|---|---|
| _(screenshot)_ | _(screenshot)_ | _(screenshot)_ |

---

## Table of Contents

- [Features](#features)
- [Supported Databases](#supported-databases)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Local Development](#local-development)
  - [Lab Databases (Docker)](#lab-databases-docker)
  - [Production with PM2](#production-with-pm2)
- [Configuration](#configuration)
- [Default Credentials](#default-credentials)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Tech Stack](#tech-stack)
- [Troubleshooting](#troubleshooting)
- [Related Projects](#related-projects)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### 📊 Unified Multi-Database Dashboard
Monitor all your database instances from a single pane of glass with real-time health scores, live performance metrics, and instant status visibility.

- **Health scoring (0–100)** per database — composite of latency, error rate, connection pool usage, and replication lag
- **Live stats on every card** — active connections vs max, p50 latency, TPS, cache hit %, database size, days-until-full
- **Replica role badges** — primary/replica/standby with lag shown inline
- **Multi-environment support** — dev, staging, production side by side with colour-coded environment badges
- **Test connection** on demand — verify credentials before saving
- **Query console** per database — run SQL, MongoDB queries, and Redis commands directly from the browser, with history

### 📈 Performance Monitoring
Deep per-database performance charts with configurable time windows.

- **Time ranges:** 1h / 6h / 24h / 7d
- **Metrics tracked:** TPS, latency p50/p95/p99, active connections, connection pool %, CPU, memory, disk read/write, cache hit ratio
- **Real data** from native engine instrumentation (`pg_stat_database`, `SHOW GLOBAL STATUS`, `serverStatus`, Redis `INFO`)
- **All 6 engines** in the selector — no filtering by engine type

### ⚡ Slow Query Tracking & AI Analysis
Automatic capture and AI-assisted resolution of slow queries across all engines.

- **Auto-capture** from `pg_stat_statements`, MySQL `performance_schema.events_statements_summary_by_digest`, SQL Server `sys.dm_exec_query_stats`, MongoDB `system.profile`, Redis SLOWLOG
- **Configurable threshold** — flag queries above N milliseconds (default 1000ms)
- **One-click AI analysis** per query — bottleneck identification, index suggestions, rewrite strategies, estimated gain, confidence score
- **Query history** — deduplicates by query fingerprint, retains top 200

### 🧠 AI Copilot (Groq-powered)
A conversational database expert with full awareness of your environment.

**What it knows in real-time:**
- All database names, engines, versions, status, health scores
- Live performance: TPS, latency p50/p95/p99, connections, cache hit ratio
- Capacity: total/data/index/free size, top tables by size, growth rate
- Full schema: table names, row counts, column counts, index counts
- Replication: role, lag seconds, sync state, connected replicas
- Last successful backup: type, age, file size
- Top 8 slow queries with SQL
- All open security findings with fix recommendations
- Active incidents with severity and timestamps
- Pending autonomous proposals
- Active automation rules
- On-call schedule (who is on-call now)
- SLA targets per severity
- Alert routing rules
- All alert thresholds from settings

**Categorised prompt library:**
- ⚡ Query optimization — EXPLAIN, indexes, rewrites
- 📊 Performance analysis — bottleneck diagnosis, connection pools
- 🛡 Security guidance — privilege audits, encryption, hardening
- 💾 Capacity planning — growth projections, archival strategies
- ⚠ Incident RCA — root cause analysis
- 🗄 Backup & recovery — PITR, RPO/RTO

**Conversation history** — auto-saves after every exchange, persisted server-side (50 sessions), resumable from history drawer.

### 🔍 AI Query Analyser
Paste any SQL/NoSQL query for instant AI-powered analysis.

- Natural language explanation of what the query does
- Bottleneck identification (full table scan, missing index, correlated subquery, etc.)
- Concrete optimisation suggestions with before/after comparison
- Ready-to-copy `CREATE INDEX` statements
- Query rewrite suggestions
- Confidence scoring (0–100%)
- Per-engine support: PostgreSQL, MySQL, SQL Server, MongoDB, Redis, CouchBase
- Query retained per engine when switching — switching back restores your work

### 📐 Schema Explorer
Browse the live schema of every connected database.

- Tables with row counts, data size, index size, last analyzed time
- Column details: name, type, nullable, default value
- Index details: name, columns, unique flag, index type
- Click-to-expand table detail panel
- Search by table or schema name
- Real data from `information_schema`, `pg_stat_user_tables`, `sys.tables`, MongoDB `collStats`

### 🔁 Replication Monitoring
Real-time health tracking for all replicated databases.

- **PostgreSQL:** streaming replication lag in seconds and bytes, sync state, WAL sender status, connected replica count
- **MySQL:** primary/replica lag monitoring
- **SQL Server:** Always On AG support (when replicas are configured)
- Click-to-expand detail panel with lag meter, exact timestamps, and quick-check diagnostic SQL (copy button)
- Auto-raises incidents when lag exceeds the configured threshold

### 📦 Capacity Planning
Track database growth and predict storage exhaustion.

- **Real sizes** from engine-native queries (not estimates):
  - PostgreSQL: `pg_database_size()`, `pg_indexes_size()`, data/index split
  - MySQL: `information_schema` — real `data_length`, `index_length`, `data_free`
  - MongoDB: `dbStats` — `dataSize`, `indexSize`, filesystem free
  - SQL Server: `sys.database_files`
  - Redis: `maxmemory` vs `used_memory`
- Top 5 tables by size per database
- Growth rate calculated from consecutive collector runs (5-min interval)
- **"Days until full"** — real calculation when growth data exists; shows "stable" for idle databases
- Index bloat detection (PostgreSQL: dead tuple ratio; MySQL: InnoDB `DATA_FREE`)
- Bloat remediation commands dynamically generated per engine

### 🔒 Security & Compliance
Continuous security posture monitoring with actionable findings.

- **PostgreSQL:** superuser login roles, SSL enforcement, `pg_hba.conf` config
- **MySQL:** users without password, root remote access
- **Redis:** no requirepass configured
- **SQL Server:** logins without password policy/expiration
- Per-database security summary with clickable filter to drill into findings
- Open/acknowledged/resolved status tracking
- One-click acknowledge with audit trail
- Security score per database (0–100)

### 💾 Backup & Recovery Management
Full lifecycle backup management with real execution.

- **Real backups** via `docker exec` against lab containers:
  - PostgreSQL: `pg_dump -Fc` (custom format, 26MB typical)
  - MySQL: `mysqldump | gzip` (compressed SQL)
  - MongoDB: `mongodump --archive --gzip`
  - Redis: `BGSAVE` → copy `dump.rdb`
  - SQL Server: `BACKUP DATABASE TO DISK` → `docker cp`
- **Scheduled backups** — cron-based with configurable retention (default 7 days)
- **RPO/RTO tracking** per job
- **Backup detail modal** — file path, size, duration, exact timestamps
- **Cleanup** — prune backups older than retention window
- Storage stats: file count, total size, oldest backup date

### 🚨 Incident Management
Full incident lifecycle from auto-raise to resolution.

- **Auto-raised** by monitor on threshold breaches:
  - DB unreachable
  - Replication lag exceeded
  - Slow query spike
  - High connection pool usage
  - Disk critical (MongoDB/Redis — real filesystem data)
  - Table bloat (PostgreSQL)
  - Security finding detected
- **Acknowledge / resolve / assign** with notes
- **SLA tracking** — configurable ack/resolve targets per severity (critical 15min/1h, high 30min/4h, medium 2h/8h, low 8h/24h)
- **Alert routing** — route incidents to Slack, email, or on-call based on severity + category (first-match wins)
- **Escalation policies** — multi-step escalation if incident remains unacknowledged
- **On-call schedule** — weekly rotation, time-zone aware

### 🤖 Automation Engine
Rule-based automation with real SQL execution and full audit trail.

- **Trigger types:** cron (scheduled) or threshold (metric breach)
- **Supported actions:** `run_sql`, `slack_notify`, `kill_query`, `vacuum`, `analyze`, `reindex`, `config_change`
- **Run confirmation modal** — shows rule name, target DB, action types, and SQL to execute before firing
- **Real execution** on target database via connection pool
- **Run history** — last 500 runs stored; click any run for full output
- **Enable/disable** per rule without deleting

### 🧬 Autonomous Proposals
AI-generated, human-approved remediation for detected issues.

- **Auto-generated** from slow query spikes, replication lag, security findings, capacity alerts
- Each proposal includes: severity, risk level (low/medium/high), confidence %, estimated gain, proposed action, SQL
- **Approve → real execution** — runs actual SQL on the target database (e.g. `ANALYZE;`)
- **Advisory proposals** — for issues that require manual steps, explains what to do
- **Auto-execute toggle** per proposal — enable for fully autonomous mode
- **Dismiss** with audit record

---

## Supported Databases

| Engine | Versions | Driver | Collector | Query Console | Backup |
|---|---|---|---|---|---|
| **PostgreSQL** | 13+ | `pg` | ✅ Full | ✅ | ✅ pg_dump |
| **MySQL / MariaDB** | 8+ | `mysql2` | ✅ Full | ✅ | ✅ mysqldump |
| **MongoDB** | 7+ | `mongodb` | ✅ Full | ✅ `db.collection.find()` | ✅ mongodump |
| **Redis** | 7+ | `ioredis` | ✅ Full | ✅ Raw commands | ✅ BGSAVE |
| **SQL Server** | 2019+ | `mssql` | ✅ Full | ✅ | ✅ BACKUP TO DISK |
| **CouchBase** | 7+ | _(planned)_ | 🔜 | 🔜 | 🔜 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React / SWR)                  │
│  Dashboard UI  ←──── REST API ────→  Next.js API Routes  │
└──────────────────────────┬──────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │      Collector          │  PM2 cron · every 5 min
              │  pg · mysql · mongo     │
              │  redis · mssql          │
              └────────────┬────────────┘
                           │ writes
              ┌────────────▼────────────┐
              │    data/*.json store     │
              │  perf-snapshots.json     │
              │  slow-queries.json       │
              │  schema.json             │
              │  capacity.json           │
              │  replication.json        │
              │  security.json           │
              │  incidents.json          │
              │  databases.json          │
              └────────────┬────────────┘
                           │ reads
              ┌────────────▼────────────┐
              │       Monitor           │  runs after every collect
              │  threshold eval         │
              │  auto-incident create   │
              │  autonomous proposals   │
              └─────────────────────────┘
```

**Key design decisions:**
- **No external database** — JSON file store keeps the deployment footprint zero. A time-series DB (InfluxDB, TimescaleDB) can be swapped in for longer retention.
- **PM2 cluster mode** — the app itself; the collector runs as a separate PM2 fork process on a 5-minute cron.
- **Native drivers** — direct connection to each engine, no proxy layer.

---

## Requirements

- Node.js 20+
- npm 9+
- PM2 (`npm install -g pm2`)
- Docker + Docker Compose (for lab environment)
- A Groq API key (free at [console.groq.com](https://console.groq.com)) for AI features

---

## Installation

### Local Development

```bash
git clone https://github.com/vynops/VynDB.git
cd VynDB
npm install
cp .env.local.example .env.local   # edit and set VYNDB_SECRET, GROQ_API_KEY
npm run dev
```

App runs on **http://localhost:3060**

### Lab Databases (Docker)

A full lab environment with PostgreSQL (primary + replica), MySQL, MongoDB, Redis, and SQL Server:

```bash
# Run as labdb user
cd labdb
bash setup-databases.sh

# Seed connections into VynDB (run as vyndb user)
node scripts/seed-connections.js /path/to/VynDB
```

**Lab database credentials:** `labdb` / `labdb_P@ss2024` on all engines. Redis has no password.

### Production with PM2

```bash
# Install dependencies (production only)
npm install --omit=dev

# Build
npm run build

# Start with PM2
pm2 start ecosystem.config.js
pm2 save

# Check status
pm2 list
pm2 logs vyndb
```

The `ecosystem.config.js` starts two processes:
- `vyndb` — the Next.js server (cluster mode, port 3060)
- `vyndb-collector` — metric collector (fork mode, cron `*/5 * * * *`)

### nginx Reverse Proxy (optional)

```nginx
server {
    listen 80;
    server_name db.yourdomain.com;

    location / {
        proxy_pass         http://localhost:3060;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

---

## Configuration

Set in **Settings** (in-app) or directly in `data/settings.json`:

| Key | Default | Description |
|---|---|---|
| `groqApiKey` | — | Groq API key for AI Copilot and Query Analyzer |
| `aiModel` | `llama-3.3-70b-versatile` | Groq model — also supports `llama-3.1-8b-instant`, `mixtral-8x7b-32768` |
| `slowQueryThresholdMs` | `1000` | Flag queries slower than N ms |
| `replicationLagAlertSec` | `30` | Auto-raise incident when replica lags beyond N seconds |
| `connectionPoolPctAlert` | `80` | Alert when pool usage exceeds N% |
| `backupRpoBreachAlertHrs` | `25` | Alert when last backup is older than N hours |
| `backupRetentionDays` | `7` | Days to keep backup files |
| `backupPath` | `./backups` | Directory for backup files |
| `defaultRefreshInterval` | `30` | Dashboard auto-refresh in seconds |
| `timezone` | `UTC` | Display timezone |
| `slackWebhookUrl` | — | Slack webhook URL for alert notifications |
| `alertEmailEnabled` | `false` | Enable SMTP email alerts |
| `smtpHost` / `smtpPort` / `smtpUser` / `smtpPassword` | — | SMTP config for email notifications |

### Environment Variables (`.env.local`)

```bash
VYNDB_SECRET=your-jwt-secret-at-least-32-chars
VYNDB_COLLECTOR_TOKEN=your-collector-token
GROQ_API_KEY=gsk_...   # optional if set in app settings
```

---

## Default Credentials

| User | Email | Password | Role |
|---|---|---|---|
| Admin | `admin@vyndb.local` | `changeme` | Full access |
| Viewer | `viewer@vyndb.local` | `viewer123` | Read-only |

> **Change these immediately in production** via Settings → Team.

### Role Permissions

| Action | Admin | Editor | Viewer |
|---|---|---|---|
| View all data | ✅ | ✅ | ✅ |
| Add/edit databases | ✅ | ✅ | ❌ |
| Acknowledge incidents | ✅ | ✅ | ❌ |
| Run automation rules | ✅ | ✅ | ❌ |
| Approve autonomous proposals | ✅ | ✅ | ❌ |
| Manage settings | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |

---

## Project Structure

```
VynDB/
├── src/
│   ├── app/
│   │   ├── (dashboard)/            # All authenticated pages
│   │   │   ├── overview/           # Fleet overview + health summary
│   │   │   ├── databases/          # DB list + query console
│   │   │   ├── performance/        # Time-series charts
│   │   │   ├── slow-queries/       # Slow query list + AI analysis
│   │   │   ├── schema/             # Schema explorer
│   │   │   ├── replication/        # Replication health
│   │   │   ├── capacity/           # Size + growth analytics
│   │   │   ├── security/           # Security findings
│   │   │   ├── backups/            # Backup jobs + schedules
│   │   │   ├── incidents/          # Incident management
│   │   │   ├── sla/                # SLA tracking
│   │   │   ├── routing/            # Alert routing + escalation
│   │   │   ├── oncall/             # On-call schedule
│   │   │   ├── automation/         # Automation rules + run history
│   │   │   ├── autonomous/         # AI proposals + approval
│   │   │   ├── copilot/            # AI Copilot chat
│   │   │   ├── queries/            # AI Query Analyzer
│   │   │   ├── team/               # User management
│   │   │   └── settings/           # App configuration
│   │   ├── api/                    # Next.js API routes
│   │   └── login/                  # Auth page
│   ├── lib/
│   │   ├── collectors/
│   │   │   ├── index.ts            # Collector orchestrator
│   │   │   ├── pg-collector.ts     # PostgreSQL collector
│   │   │   ├── mysql-collector.ts  # MySQL collector
│   │   │   ├── mongo-collector.ts  # MongoDB collector
│   │   │   ├── redis-collector.ts  # Redis collector
│   │   │   └── mssql-collector.ts  # SQL Server collector
│   │   ├── db-connections.ts       # Connection pool management
│   │   ├── db-store.ts             # Data access + demo data
│   │   ├── backup-runner.ts        # Docker-based backup execution
│   │   ├── monitor.ts              # Threshold eval + auto-incidents
│   │   ├── incident-store.ts       # Incidents + on-call + routing
│   │   ├── automation-store.ts     # Rules + proposals
│   │   ├── auth.ts                 # JWT auth
│   │   ├── notifier.ts             # Slack + email notifications
│   │   └── settings-store.ts       # App settings
│   └── types/
│       └── mssql.d.ts              # SQL Server type declarations
├── labdb/
│   ├── docker-compose.yml          # Lab DB containers
│   ├── setup-databases.sh          # Start containers + run init scripts
│   ├── setup-app.sh                # Install + build + start VynDB
│   └── scripts/
│       ├── init-postgres.sql
│       ├── init-mysql.sql
│       ├── init-mongo.js
│       ├── init-sqlserver.sql
│       └── seed-connections.js     # Write databases.json for lab
├── data/                           # Runtime data (git-ignored)
├── backups/                        # Backup files (git-ignored)
├── ecosystem.config.js             # PM2 configuration
└── next.config.ts
```

---

## API Reference

All endpoints require a valid session cookie (login at `/login`) or Bearer token for collector routes.

### Authentication
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user info |

### Databases
| Method | Path | Description |
|---|---|---|
| GET | `/api/databases` | List all databases |
| POST | `/api/databases` | Add database connection |
| PUT | `/api/databases/:id` | Update connection |
| DELETE | `/api/databases/:id` | Remove connection |
| POST | `/api/databases/test` | Test connection |
| POST | `/api/databases/:id/query` | Execute query (editor+) |

### Metrics
| Method | Path | Description |
|---|---|---|
| GET | `/api/performance?dbId=&hours=` | Performance snapshots |
| GET | `/api/slow-queries` | Slow query list |
| POST | `/api/slow-queries/:id/analyze` | AI-analyze a query |
| GET | `/api/schema?dbId=` | Schema tables |
| GET | `/api/replication` | Replication status |
| GET | `/api/capacity` | Capacity data |
| GET | `/api/security` | Security findings |
| PATCH | `/api/security/:id` | Update finding status |

### Operations
| Method | Path | Description |
|---|---|---|
| POST | `/api/collect` | Trigger metric collection |
| POST | `/api/monitor` | Evaluate thresholds |
| POST | `/api/backups/run` | Run backup(s) |
| GET | `/api/backups` | List backup jobs |
| DELETE | `/api/backups/:id` | Delete backup |
| POST | `/api/backups/cleanup` | Purge old backups |

### Incidents
| Method | Path | Description |
|---|---|---|
| GET | `/api/incidents` | List incidents |
| POST | `/api/incidents` | Create incident |
| PATCH | `/api/incidents/:id` | Update status/notes |

### AI
| Method | Path | Description |
|---|---|---|
| POST | `/api/copilot` | Chat with AI Copilot |
| GET | `/api/copilot/history` | Conversation history |
| POST | `/api/copilot/history` | Save session |
| DELETE | `/api/copilot/history?id=` | Delete session |
| POST | `/api/queries/analyze` | AI Query Analyzer |

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server components + API routes |
| Language | TypeScript 5 | Strict mode |
| UI | React 19, Tailwind CSS 4 | Dark theme throughout |
| Charts | Recharts 2 | Area + line charts |
| Data fetching | SWR | Auto-refresh, cache invalidation |
| Icons | Lucide React | Consistent icon set |
| DB drivers | pg, mysql2, mongodb, ioredis, mssql | Native, no ORMs |
| AI | Groq SDK | Llama 3.3 70B Versatile |
| Auth | jose (JWT) | PBKDF2 password hashing |
| Email | Nodemailer | SMTP with TLS |
| Process mgr | PM2 | Cluster + cron |
| Storage | JSON files | Zero-dependency, easily swappable |

---

## Troubleshooting

### App won't start — "could not find a production build"
```bash
cd /path/to/VynDB
npm run build
pm2 restart vyndb
```

### MongoDB authentication failed
The `labdb` user is created in the `labdb` database. If you see "Authentication failed", check that the connection uses `authSource=labdb` (not `authSource=admin`). VynDB handles this automatically since v1.

### SQL Server collector errors — "Invalid column name"
Grant `VIEW SERVER STATE` to the connecting user:
```sql
GRANT VIEW SERVER STATE TO labdb;
```

### Copilot returns "Groq API key not configured"
Set the key in **Settings → AI Copilot** or in `.env.local`:
```bash
GROQ_API_KEY=gsk_your_key_here
```

### Backups failing for MongoDB
The backup runner uses a `backup` user with password `backup123`. Create it if missing:
```javascript
// In mongosh as admin:
db.getSiblingDB('labdb').createUser({
  user: 'backup', pwd: 'backup123',
  roles: [{ role: 'read', db: 'labdb' }]
})
```

### Disk critical incidents keep re-raising
This is normal if your lab database host has real low disk space. The monitor only raises disk incidents for MongoDB and Redis (which expose real filesystem free space). PostgreSQL and MySQL disk alerts require real OS-level free space data not available via SQL.

---


## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

**Areas where contributions are especially welcome:**
- CouchBase collector (`src/lib/collectors/couchbase-collector.ts`)
- Oracle collector (requires Oracle Instant Client)
- Time-series storage backend (replace JSON with InfluxDB/TimescaleDB)
- EXPLAIN plan visualisation
- Dark/light theme toggle

---
## Part of the VynOps Suite

| Product | Purpose | Repo |
|---|---|---|
| **VynOps** | Kubernetes operations platform | [vynops/VynOps](https://github.com/vynops/VynOps) |
| **VynAI** | Ollama fleet manager and AI gateway | [vynops/VynAI](https://github.com/vynops/VynAI) |
| **VynCost** | Cloud cost visibility | [vynops/VynCost](https://github.com/vynops/VynCost) |
| **VynDB** | Database operations | [vynops/VynDB](https://github.com/vynops/VynDB) |
| **VynDC** | Data center management | [vynops/VynDC](https://github.com/vynops/VynDC) |
| **VynCICD** | CI/CD pipeline management | [vynops/VynCICD](https://github.com/vynops/VynCICD) |
| **VynHana** | SAP HANA Database management | [vynops/VynHana](https://github.com/vynops/VynHana) |
| **VynSAP** | SAP ERP management | [vynops/VynSAP](https://github.com/vynops/VynSAP) |


---

## License

MIT — see [LICENSE](LICENSE)

---

