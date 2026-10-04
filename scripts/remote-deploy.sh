#!/bin/bash
# Runs ON THE SERVER (uploaded and started by scripts/deploy.sh - do not run by hand).
#   remote-deploy.sh <new-sha> <prev-sha> <services: api,web> <auto-rollback 0|1>
# Inputs in ~/deploys/<new-sha>/: payload.tar, files.txt (changed paths), removed.txt, migrations.txt
# Output: ~/deploys/<new-sha>/result = OK | FAILED_BUILD | ROLLED_BACK | FAILED
set -uo pipefail

SHA=$1; PREV=$2; SERVICES=${3//,/ }; AUTO=${4:-1}
D=$HOME/deploys/$SHA
APP=$HOME/fintech
TS=$(date +%Y%m%d_%H%M%S)
DUMP=$HOME/backups/fintech_${TS}_before_deploy_${SHA}.sql.gz
FILES_BK=$HOME/backups/files_${TS}_before_${SHA}.tgz

finish() { echo "$1" > "$D/result"; echo "RESULT: $1"; exit "${2:-0}"; }
dc() { sg docker -c "cd $APP && $*" < /dev/null; }
healthy() {
  curl -fsS localhost/api/health 2>/dev/null | grep -q '"ok":true' &&
    [ "$(curl -s -o /dev/null -w '%{http_code}' localhost/)" = 200 ]
}

rm -f "$D/result"
cd "$APP" || finish FAILED 1
mkdir -p "$HOME/backups"
echo "== deploy $PREV -> $SHA  services: $SERVICES  ($TS)"

echo "== 1/6 database backup"
sg docker -c "cd $APP && docker compose exec -T db sh -c 'pg_dump -U \$POSTGRES_USER \$POSTGRES_DB'" < /dev/null | gzip > "$DUMP"
TABLES=$(zcat "$DUMP" | grep -c 'CREATE TABLE')
echo "dump: $DUMP ($TABLES tables)"
[ "$TABLES" -gt 0 ] || finish FAILED 1

echo "== 2/6 back up the files that will be replaced"
: > "$D/replaced.txt"; : > "$D/added.txt"
while read -r f; do
  [ -n "$f" ] || continue
  if [ -f "$APP/$f" ]; then echo "$f" >> "$D/replaced.txt"; else echo "$f" >> "$D/added.txt"; fi
done < "$D/files.txt"
while read -r f; do [ -f "$APP/$f" ] && echo "$f" >> "$D/replaced.txt"; done < "$D/removed.txt"
if [ -s "$D/replaced.txt" ]; then tar -czf "$FILES_BK" -T "$D/replaced.txt"; else : > "$FILES_BK.empty"; FILES_BK=""; fi
echo "backed up $(wc -l < "$D/replaced.txt") files, $(wc -l < "$D/added.txt") are new"

echo "== 3/6 keep the running images under a rollback tag"
for s in $SERVICES; do
  dc "docker image inspect fintech-$s:latest > /dev/null" || finish FAILED 1
  dc "docker tag fintech-$s:latest fintech-$s:rollback-$PREV"
done
cat > "$D/state.env" <<EOF
SHA=$SHA
PREV=$PREV
TS=$TS
SERVICES="$SERVICES"
DUMP=$DUMP
FILES_BK=$FILES_BK
EOF

echo "== 4/6 new files in"
tar -xf "$D/payload.tar" -C "$APP"
while read -r f; do [ -n "$f" ] && rm -f "$APP/$f"; done < "$D/removed.txt"

echo "== 5/6 build ($SERVICES) - old containers keep serving meanwhile"
dc "docker compose build $SERVICES" > "$D/build.log" 2>&1
BRC=$?
tail -n 3 "$D/build.log"
if [ "$BRC" -ne 0 ]; then
  echo "build FAILED - nothing was restarted, putting the old files back"
  [ -n "$FILES_BK" ] && tar -xzf "$FILES_BK" -C "$APP"
  while read -r f; do [ -n "$f" ] && rm -f "$APP/$f"; done < "$D/added.txt"
  finish FAILED_BUILD 1
fi
dc "docker compose up -d $SERVICES"

echo "== 6/6 health check (up to 2 min)"
OK=0
for _ in $(seq 1 24); do healthy && { OK=1; break; }; sleep "${HEALTH_SLEEP:-5}"; done
if [ "$OK" -ne 1 ]; then
  echo "NOT healthy after the swap"
  dc "docker compose ps"
  dc "docker compose logs --tail 30 api" || true
  if [ "$AUTO" = 1 ]; then
    echo "auto-rollback..."
    bash "$HOME/fintech-rollback.sh" "$SHA" && finish ROLLED_BACK 1
  fi
  finish FAILED 1
fi

echo "$SHA" > "$APP/.deployed_sha"
echo "$(date -Is) $PREV -> $SHA ($SERVICES)" >> "$HOME/deploys/history.log"
dc "docker image prune -f" > /dev/null || true
dc "docker compose ps --format '{{.Name}} {{.Status}}'"
echo "health: $(curl -s localhost/api/health)"
sg docker -c "cd $APP && docker compose exec -T db sh -c 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tA'" <<'SQL'
select 'last migration: ' || name from knex_migrations order by id desc limit 1;
SQL
echo "rollback with:  bash ~/fintech-rollback.sh $SHA"
finish OK 0
