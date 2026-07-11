-- ============================================================
-- VynDB Lab — PostgreSQL 16 Schema + Seed Data
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- App role with limited privileges (for application connections)
CREATE ROLE labdb_app LOGIN PASSWORD 'app_P@ss2024';

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(255) NOT NULL,
  plan        VARCHAR(50)  DEFAULT 'free',
  country     VARCHAR(2),
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  category    VARCHAR(100),
  price       NUMERIC(10,2),
  stock       INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL,          -- intentionally no FK index (slow query demo)
  status      VARCHAR(50) DEFAULT 'pending',
  total       NUMERIC(12,2),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  shipped_at  TIMESTAMPTZ
);

CREATE TABLE order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL,          -- intentionally no FK index
  product_id  INT NOT NULL,          -- intentionally no FK index
  quantity    INT NOT NULL,
  unit_price  NUMERIC(10,2),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT NOT NULL,          -- no compound index (slow query + autonomous demo)
  event_type  VARCHAR(100) NOT NULL,
  page        VARCHAR(255),
  session_id  VARCHAR(64),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  metadata    JSONB DEFAULT '{}'
);

CREATE TABLE sessions (
  id          VARCHAR(64) PRIMARY KEY,
  user_id     INT,
  started_at  TIMESTAMPTZ DEFAULT NOW(),
  last_seen   TIMESTAMPTZ DEFAULT NOW(),
  ip          INET,
  user_agent  TEXT
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  VARCHAR(100),
  action      VARCHAR(20),
  row_id      INT,
  changed_by  VARCHAR(255),
  changed_at  TIMESTAMPTZ DEFAULT NOW(),
  old_data    JSONB,
  new_data    JSONB
);

-- ── Indexes (deliberately sparse to generate autonomous proposals) ──────────
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_events_type   ON events(event_type);
-- NOTE: orders.user_id and events(user_id, created_at) intentionally NOT indexed

-- Grant to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO labdb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO labdb_app;

-- ── Seed Data ────────────────────────────────────────────────

-- Users: 10,000 rows
INSERT INTO users (email, name, plan, country, created_at)
SELECT
  'user' || i || '@labdb.dev',
  'User ' || i,
  (ARRAY['free','pro','enterprise'])[floor(random()*3+1)],
  (ARRAY['US','GB','DE','FR','IN','JP','BR','CA','AU','SG'])[floor(random()*10+1)],
  NOW() - (random() * interval '365 days')
FROM generate_series(1, 10000) AS gs(i);

-- Products: 2,000 rows
INSERT INTO products (name, category, price, stock)
SELECT
  'Product ' || i,
  (ARRAY['Electronics','Apparel','Books','Software','Hardware','Services'])[floor(random()*6+1)],
  round((random() * 999 + 1)::numeric, 2),
  floor(random() * 1000)::int
FROM generate_series(1, 2000) AS gs(i);

-- Orders: 100,000 rows
INSERT INTO orders (user_id, status, total, created_at, shipped_at)
SELECT
  floor(random() * 10000 + 1)::int,
  (ARRAY['pending','processing','shipped','delivered','cancelled'])[floor(random()*5+1)],
  round((random() * 5000 + 10)::numeric, 2),
  NOW() - (random() * interval '180 days'),
  CASE WHEN random() > 0.3 THEN NOW() - (random() * interval '90 days') ELSE NULL END
FROM generate_series(1, 100000) AS gs(i);

-- Order items: 300,000 rows
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT
  floor(random() * 100000 + 1)::int,
  floor(random() * 2000 + 1)::int,
  floor(random() * 10 + 1)::int,
  round((random() * 500 + 5)::numeric, 2)
FROM generate_series(1, 300000) AS gs(i);

-- Events: 500,000 rows
INSERT INTO events (user_id, event_type, page, session_id, created_at, metadata)
SELECT
  floor(random() * 10000 + 1)::int,
  (ARRAY['page_view','click','purchase','signup','logout','search','download'])[floor(random()*7+1)],
  '/page/' || floor(random() * 100 + 1),
  md5(random()::text),
  NOW() - (random() * interval '90 days'),
  jsonb_build_object('source', (ARRAY['web','mobile','api'])[floor(random()*3+1)])
FROM generate_series(1, 500000) AS gs(i);

-- Audit log: 50,000 rows
INSERT INTO audit_log (table_name, action, row_id, changed_by, changed_at)
SELECT
  (ARRAY['orders','users','products'])[floor(random()*3+1)],
  (ARRAY['INSERT','UPDATE','DELETE'])[floor(random()*3+1)],
  floor(random() * 100000 + 1)::int,
  'user' || floor(random()*100+1) || '@labdb.dev',
  NOW() - (random() * interval '90 days')
FROM generate_series(1, 50000) AS gs(i);

-- Update table stats so pg_stat_user_tables has fresh data
ANALYZE users, products, orders, order_items, events, sessions, audit_log;

-- ── Simulate some slow query patterns in pg_stat_statements ─────────────────
-- Run some intentionally slow queries to populate pg_stat_statements
DO $$
BEGIN
  -- Full scan on orders (no user_id index)
  PERFORM COUNT(*) FROM orders o JOIN users u ON u.id = o.user_id WHERE u.plan = 'enterprise';
  -- Full scan on events (no compound index)
  PERFORM COUNT(*) FROM events WHERE user_id < 100 AND created_at > NOW() - interval '30 days';
  -- Aggregation without index
  PERFORM user_id, COUNT(*), SUM(total) FROM orders GROUP BY user_id HAVING COUNT(*) > 5 LIMIT 100;
END $$;
