#!/bin/bash
# ============================================================
# VynDB Lab — README for setup
# See: setup-databases.sh  (run as labdb user)
#      setup-app.sh         (run as vyndb user)
# ============================================================
echo "Run setup-databases.sh as labdb, then setup-app.sh as vyndb."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VYNDB_DIR="/home/labdb/vyndb"
LABDB_DIR="$VYNDB_DIR/labdb"

echo "======================================================"
echo " VynDB Lab Setup — $(date)"
echo "======================================================"

# ── 1. Create data directory ─────────────────────────────────
echo "[1/6] Creating data directory..."
mkdir -p "$VYNDB_DIR/data"
chmod 755 "$VYNDB_DIR/data"

# ── 2. Start Docker containers ───────────────────────────────
echo "[2/6] Starting lab database containers..."
cd "$LABDB_DIR"

# Stop any existing containers first
docker compose down --remove-orphans 2>/dev/null || true

# Build and start
docker compose up -d --build

echo "Waiting for all containers to be healthy (this may take 2-3 minutes)..."
sleep 10

# Wait for postgres primary
echo "  Waiting for PostgreSQL primary..."
until docker exec labdb-pg-primary pg_isready -U labdb -d labdb 2>/dev/null; do
  sleep 3
done
echo "  ✓ PostgreSQL primary ready"

# Wait for MySQL
echo "  Waiting for MySQL..."
until docker exec labdb-mysql mysqladmin ping -u labdb -plabdb_P@ss2024 --silent 2>/dev/null; do
  sleep 3
done
echo "  ✓ MySQL ready"

# Wait for MongoDB
echo "  Waiting for MongoDB..."
until docker exec labdb-mongodb mongosh --quiet --eval "db.adminCommand('ping')" 2>/dev/null | grep -q "ok"; do
  sleep 3
done
echo "  ✓ MongoDB ready"

# Wait for Redis
echo "  Waiting for Redis..."
until docker exec labdb-redis redis-cli ping 2>/dev/null | grep -q "PONG"; do
  sleep 3
done
echo "  ✓ Redis ready"

# Wait for replica (give it extra time for pg_basebackup)
echo "  Waiting for PostgreSQL replica (up to 60s)..."
for i in $(seq 1 20); do
  if docker exec labdb-pg-replica pg_isready -U labdb 2>/dev/null; then
    echo "  ✓ PostgreSQL replica ready"
    break
  fi
  sleep 3
done

# ── 3. Seed VynDB connection records ─────────────────────────
echo "[3/6] Seeding VynDB database connections..."
node "$LABDB_DIR/scripts/seed-connections.js" "$VYNDB_DIR"

# ── 4. Set up .env.local ─────────────────────────────────────
echo "[4/6] Creating .env.local..."
cat > "$VYNDB_DIR/.env.local" << 'EOF'
# VynDB environment — lab deployment
VYNDB_SECRET=vyndb_jwt_secret_change_in_prod_2024
VYNDB_COLLECTOR_TOKEN=vyndb_collector_token_lab_2024

# Lab database passwords (read by collectors)
LABDB_PG_PASSWORD=labdb_P@ss2024
LABDB_MYSQL_PASSWORD=labdb_P@ss2024
LABDB_MONGO_PASSWORD=labdb_P@ss2024

# Optional: Groq AI key (set your own)
# GROQ_API_KEY=your_groq_api_key_here
EOF
echo "  ✓ .env.local written"

# ── 5. Install npm dependencies ──────────────────────────────
echo "[5/6] Installing npm packages..."
cd "$VYNDB_DIR"
npm install --production 2>&1 | tail -5

# ── 6. Build and start with PM2 ─────────────────────────────
echo "[6/6] Building and starting VynDB..."
npm run build

# Stop existing PM2 processes
pm2 delete vyndb 2>/dev/null || true
pm2 delete vyndb-collector 2>/dev/null || true

# Start with ecosystem config
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "======================================================"
echo " VynDB Lab is running!"
echo " App:       http://localhost:3060"
echo " Login:     admin@vyndb.local / admin123"
echo ""
echo " Containers:"
echo "   PostgreSQL primary : localhost:5432"
echo "   PostgreSQL replica : localhost:5433"
echo "   MySQL              : localhost:3306"
echo "   MongoDB            : localhost:27017"
echo "   Redis              : localhost:6379"
echo ""
echo " Collector runs every 5 minutes automatically."
echo " To trigger manually: pm2 restart vyndb-collector"
echo "======================================================"
