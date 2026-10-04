#!/bin/bash
# Runs ON THE SERVER. Hot rollback of one deploy: no rebuild, ~15 seconds.
#   bash ~/fintech-rollback.sh <sha-that-was-deployed>
# Uses what remote-deploy.sh saved in ~/deploys/<sha>/ (state.env, replaced/added files, rollback image tags).
# CODE ONLY: database changes made by migrations or data fixes are not undone (see the note at the end).
set -uo pipefail

SHA=${1:?usage: fintech-rollback.sh <sha>}
D=$HOME/deploys/$SHA
APP=$HOME/fintech
[ -f "$D/state.env" ] || { echo "no state for $SHA in $D"; exit 1; }
# shellcheck disable=SC1091
. "$D/state.env"
dc() { sg docker -c "cd $APP && $*" < /dev/null; }

echo "== rolling back $SHA -> $PREV  (services: $SERVICES)"

echo "== 1/4 files"
if [ -n "${FILES_BK:-}" ] && [ -f "$FILES_BK" ]; then tar -xzf "$FILES_BK" -C "$APP"; fi
while read -r f; do [ -n "$f" ] && rm -f "$APP/$f"; done < "$D/added.txt"

echo "== 2/4 images"
for s in $SERVICES; do
  dc "docker image inspect fintech-$s:rollback-$PREV > /dev/null" || { echo "missing image fintech-$s:rollback-$PREV"; exit 1; }
  dc "docker tag fintech-$s:rollback-$PREV fintech-$s:latest"
done

echo "== 3/4 migrations"
# The old API refuses to start if the DB lists migrations it has no file for, unless its knexfile
# has disableMigrationsListValidation. Only older images need the rows forgotten.
if [ -s "$D/migrations.txt" ]; then
  if dc "docker run --rm --entrypoint sh fintech-api:rollback-$PREV -c 'grep -q disableMigrationsListValidation knexfile.js'"; then
    echo "old image tolerates unknown migrations - leaving the knex_migrations rows alone"
  else
    NAMES=$(grep -E '^[A-Za-z0-9_.]+$' "$D/migrations.txt" | sed "s/.*/'&'/" | paste -sd, -)
    echo "forgetting: $NAMES"
    sg docker -c "cd $APP && docker compose exec -T db sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB'" <<SQL
delete from knex_migrations where name in ($NAMES);
SQL
  fi
fi

echo "== 4/4 restart"
dc "docker compose up -d --no-build $SERVICES"
OK=0
for _ in $(seq 1 24); do
  if curl -fsS localhost/api/health 2>/dev/null | grep -q '"ok":true'; then OK=1; break; fi
  sleep "${HEALTH_SLEEP:-5}"
done
echo "$PREV" > "$APP/.deployed_sha"
echo "$(date -Is) ROLLBACK $SHA -> $PREV" >> "$HOME/deploys/history.log"
dc "docker compose ps --format '{{.Name}} {{.Status}}'"
echo "health: $(curl -s localhost/api/health)"
[ "$OK" = 1 ] && echo "ROLLED BACK to $PREV (code)." || echo "WARNING: not healthy after rollback - check: docker compose logs api"
if [ -s "$D/migrations.txt" ]; then
  echo "NOTE: this deploy ran migrations ($(wc -l < "$D/migrations.txt")). Their schema/data changes are still in the database."
fi
echo "Pre-deploy DB dump (restore ONLY if the data must go back too, losing everything written since): $DUMP"
[ "$OK" = 1 ]
