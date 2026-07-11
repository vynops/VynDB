#!/bin/bash
# ============================================================
# VynDB Lab — Step 1: Start lab databases
# Run as: labdb user on the deployment server
# ============================================================
set -e

LABDB_DIR="/home/labdb/labdb"

echo "======================================================"
echo " VynDB Lab — Starting database containers"
echo " User: $(whoami)  |  $(date)"
echo "======================================================"

cd "$LABDB_DIR"

# Stop any existing containers
docker compose down --remove-orphans 2>/dev/null || true

# Start containers
docker compose up -d

echo ""
echo "Waiting for containers to become healthy..."

# PostgreSQL primary
echo -n "  PostgreSQL primary... "
until docker exec labdb-pg-primary pg_isready -U labdb -d labdb >/dev/null 2>&1; do sleep 2; done
echo "ready"

# MySQL
echo -n "  MySQL... "
until docker exec labdb-mysql mysqladmin ping -u labdb -p'labdb_P@ss2024' --silent >/dev/null 2>&1; do sleep 2; done
echo "ready"

# MongoDB
echo -n "  MongoDB... "
until docker exec labdb-mongodb mongosh --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; do sleep 2; done
echo "ready"

# Redis
echo -n "  Redis... "
until docker exec labdb-redis redis-cli ping 2>/dev/null | grep -q PONG; do sleep 2; done
echo "ready"

# PostgreSQL replica (extra time for pg_basebackup)
echo -n "  PostgreSQL replica (up to 90s)... "
for i in $(seq 1 30); do
  if docker exec labdb-pg-replica pg_isready -U labdb >/dev/null 2>&1; then
    echo "ready"; break
  fi
  sleep 3
  if [ "$i" -eq 30 ]; then echo "timeout (check: docker logs labdb-pg-replica)"; fi
done

echo ""
echo "======================================================"
echo " Database containers are running:"
echo "   PostgreSQL primary : localhost:5432"
echo "   PostgreSQL replica : localhost:5433"
echo "   MySQL              : localhost:3306"
echo "   MongoDB            : localhost:27017"
echo "   Redis              : localhost:6379"
echo ""
echo " Next: run setup-app.sh as vyndb user"
echo "======================================================"
