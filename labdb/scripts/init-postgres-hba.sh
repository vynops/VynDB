#!/bin/bash
# Appended during PostgreSQL init — allow replica to do basebackup and replication
echo "host replication all 0.0.0.0/0 trust" >> "$PGDATA/pg_hba.conf"
echo "host all all 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
