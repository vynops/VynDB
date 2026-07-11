module.exports = {
  apps: [
    // ── VynDB Next.js app ──────────────────────────────────
    {
      name: 'vyndb',
      script: 'node_modules/.bin/next',
      args: 'start -p 3060',
      cwd: '/home/vyndb/vyndb',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3060,
      },
      error_file: '/home/vyndb/logs/vyndb-error.log',
      out_file:   '/home/vyndb/logs/vyndb-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ── Metrics collector (runs every 5 minutes via cron_restart) ──
    {
      name: 'vyndb-collector',
      script: '/home/vyndb/vyndb/scripts/trigger-collect.sh',
      cron_restart: '*/5 * * * *',
      autorestart: false,
      watch: false,
      interpreter: '/bin/bash',
      error_file: '/home/vyndb/logs/collector-error.log',
      out_file:   '/home/vyndb/logs/collector-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
}
