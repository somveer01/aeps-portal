#!/bin/sh
set -e

# Wait for the database, then apply migrations. Seeds run once on first boot
# (idempotent) when RUN_SEED=true — set it for the very first deploy, then unset.
echo "Running database migrations..."
npx knex migrate:latest

if [ "$RUN_SEED" = "true" ]; then
  echo "Seeding database (idempotent)..."
  npx knex seed:run
fi

echo "Starting API..."
exec "$@"
