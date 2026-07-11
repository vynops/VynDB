#!/bin/bash
# ============================================================
# VynDB Lab — Step 2: Deploy and start VynDB app
# Run as: vyndb user on the deployment server
# ============================================================
set -e

VYNDB_DIR="/home/vyndb/vyndb"

echo "======================================================"
echo " VynDB App Setup"
echo " User: $(whoami)  |  $(date)"
echo "======================================================"

cd "$VYNDB_DIR"

# ── 1. Create directories ────────────────────────────────────
echo "[1/5] Creating data and log directories..."
mkdir -p data logs
chmod 750 data logs

# ── 2. Write .env.local ──────────────────────────────────────
echo "[2/5] Writing .env.local..."
cat > .env.local << 'EOF'
# VynDB — production environment
VYNDB_SECRET=vyndb_jwt_secret_change_this_2024
VYNDB_COLLECTOR_TOKEN=vyndb_collector_token_lab_2024

# Lab DB credentials (read by collectors)
LABDB_PG_PASSWORD=labdb_P@ss2024
LABDB_MYSQL_PASSWORD=labdb_P@ss2024
LABDB_MONGO_PASSWORD=labdb_P@ss2024

# Optional: Groq AI key for AI features
# GROQ_API_KEY=gsk_your_key_here
EOF
echo "  ✓ .env.local written"

# ── 3. Seed lab DB connections ───────────────────────────────
echo "[3/5] Seeding lab database connections..."
node "$VYNDB_DIR/labdb/scripts/seed-connections.js" "$VYNDB_DIR"

# ── 4. Install dependencies ──────────────────────────────────
echo "[4/5] Installing npm packages..."
npm install --omit=dev 2>&1 | grep -E "added|updated|audited|WARN|ERR" || true

# ── 5. Build + start with PM2 ───────────────────────────────
echo "[5/5] Building VynDB..."
npm run build

echo "Starting with PM2..."
pm2 delete vyndb 2>/dev/null || true
pm2 delete vyndb-collector 2>/dev/null || true
pm2 start "$VYNDB_DIR/ecosystem.config.js"
pm2 save

echo ""
echo "======================================================"
echo " VynDB is running!"
echo ""
echo " URL:    http://$(hostname -I | awk '{print $1}'):3060"
echo " Login:  admin@vyndb.local / admin123"
echo ""
echo " PM2 status:  pm2 list"
echo " App logs:    pm2 logs vyndb"
echo " Collector:   pm2 logs vyndb-collector"
echo ""
echo " First metrics collection in ~5 minutes."
echo " Manual trigger: curl -X POST http://localhost:3060/api/collect \\"
echo "   -H 'Authorization: Bearer vyndb_collector_token_lab_2024'"
echo "======================================================"
