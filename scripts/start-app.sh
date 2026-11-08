#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
node "$APP_DIR/scripts/ensure-env.mjs"
exec "$APP_DIR/node_modules/.bin/next" start -p 3060