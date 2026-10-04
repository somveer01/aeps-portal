#!/usr/bin/env bash
# One-command production deploy / rollback for the AEPS portal (Docker Compose on EC2).
#
#   scripts/deploy.sh                  deploy origin/main (asks for confirmation)
#   scripts/deploy.sh --dry-run        show the plan and run the read-only checks, change nothing
#   scripts/deploy.sh rollback [sha]   hot rollback of the last (or the given) deploy
#   scripts/deploy.sh status           what is running, health, recent deploys
#
# Options: --yes (no prompt)  --from <sha> (what the server runs now, if it has no marker yet)
#          --skip-tests  --no-auto-rollback  --force (ignore server drift)  -h
#
# What a deploy does: checks (on main, clean, pushed) -> lint + tests -> works out which files
# changed since the deployed commit -> refuses if someone edited those files on the server ->
# uploads only the changed files -> on the server: DB backup, rollback image tags, rebuild only
# api and/or web, swap, health check, automatic rollback if the site is not healthy.
#
# Config (never committed): copy .deploy.env.example to .deploy.env and fill in your own values.
set -euo pipefail

CMD=deploy; DRY=0; YES=0; FROM=""; SKIP_TESTS=0; AUTO=1; FORCE=0; POS=""
while [ $# -gt 0 ]; do
  case "$1" in
    deploy|rollback|status) CMD=$1 ;;
    --dry-run) DRY=1 ;;
    --yes|-y) YES=1 ;;
    --from) FROM=${2:?--from needs a commit}; shift ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --no-auto-rollback) AUTO=0 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) POS=$1 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# A failed precondition stops a real deploy, but only warns in --dry-run.
must() { if [ "$DRY" = 1 ]; then warn "$* (would stop a real deploy)"; else die "$*"; fi; }

cd "$(git rev-parse --show-toplevel)"
if [ -f .deploy.env ]; then set -a; . ./.deploy.env; set +a; fi
DEPLOY_USER=${DEPLOY_USER:-ubuntu}
[ -n "${DEPLOY_HOST:-}" ] && [ -n "${DEPLOY_KEY:-}" ] || die "set DEPLOY_HOST and DEPLOY_KEY (copy .deploy.env.example to .deploy.env)"
command -v cygpath > /dev/null 2>&1 && DEPLOY_KEY=$(cygpath -u "$DEPLOY_KEY")
[ -f "$DEPLOY_KEY" ] || die "key file not found: $DEPLOY_KEY"

SSH_OPTS=(-i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=15)
TARGET="$DEPLOY_USER@$DEPLOY_HOST"
rssh()  { ssh "${SSH_OPTS[@]}" "$TARGET" "$@" < /dev/null; }
rscp()  { scp -q "${SSH_OPTS[@]}" "$@"; }
reachable() { rssh true > /dev/null 2>&1; }
is_sha() { [[ "$1" =~ ^[0-9a-f]{7,40}$ ]]; }

# ---------------------------------------------------------------- status
if [ "$CMD" = status ]; then
  reachable || die "cannot reach the server"
  say "local HEAD   : $(git rev-parse --short=7 HEAD)   origin/main: $(git rev-parse --short=7 origin/main 2> /dev/null || echo '?')"
  rssh 'cd ~/fintech && echo "server runs  : $(cat .deployed_sha 2>/dev/null || echo unknown)"; echo "-- recent deploys"; tail -n 5 ~/deploys/history.log 2>/dev/null; echo "-- containers"; sg docker -c "docker compose ps --format \"{{.Name}} {{.Status}}\"" < /dev/null; echo "-- health"; curl -s localhost/api/health; echo'
  exit 0
fi

# ---------------------------------------------------------------- rollback
if [ "$CMD" = rollback ]; then
  reachable || die "cannot reach the server"
  SHA=${POS:-$(rssh 'cat ~/fintech/.deployed_sha 2>/dev/null' || true)}
  is_sha "$SHA" || die "no deploy to roll back (pass the sha you want to undo)"
  rssh "test -f ~/deploys/$SHA/state.env" || die "the server has no rollback data for $SHA"
  say "Rollback of deploy $SHA (code only; database changes stay)."
  if [ "$YES" != 1 ]; then read -r -p "Roll back production now? [y/N] " a; [ "$a" = y ] || [ "$a" = Y ] || die "cancelled"; fi
  rssh "bash ~/fintech-rollback.sh $SHA"
  exit 0
fi

# ---------------------------------------------------------------- deploy: checks
BR=$(git rev-parse --abbrev-ref HEAD)
[ "$BR" = main ] || must "not on main (on '$BR')"
[ -z "$(git status --porcelain)" ] || must "working tree has uncommitted changes"
git fetch -q origin main || warn "could not fetch origin"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main 2> /dev/null || echo none)" ] || must "HEAD is not the same as origin/main - merge and push first"
SHORT=$(git rev-parse --short=7 HEAD)

UP=0; reachable && UP=1
if [ "$UP" = 0 ]; then [ "$DRY" = 1 ] && warn "server not reachable - skipping the server-side checks" || die "cannot reach the server ($DEPLOY_HOST)"; fi

PREV=${FROM:-}
if [ -z "$PREV" ] && [ "$UP" = 1 ]; then PREV=$(rssh 'cat ~/fintech/.deployed_sha 2>/dev/null' || true); fi
[ -n "$PREV" ] || die "the server has no .deployed_sha marker yet - pass --from <sha of what runs now>"
git cat-file -e "$PREV^{commit}" 2> /dev/null || die "unknown commit: $PREV"
PREV=$(git rev-parse --short=7 "$PREV")
[ "$PREV" != "$SHORT" ] || { say "Server already runs $SHORT - nothing to deploy."; exit 0; }
git merge-base --is-ancestor "$PREV" HEAD || die "$PREV is not an ancestor of $SHORT (use 'rollback' to go back)"

# ---------------------------------------------------------------- deploy: what changed
FILES=(); REMOVED=(); MIGS=(); NEED_API=0; NEED_WEB=0
SKIP_RE='^(api/test/|api/\.env|.*\.md$)'
while IFS=$'\t' read -r st path; do
  [[ "$path" =~ ^(api|app)/ ]] || continue
  [[ "$path" =~ $SKIP_RE ]] && continue
  case "$st" in
    D) REMOVED+=("$path") ;;
    *) FILES+=("$path"); if [ "$st" = A ] && [[ "$path" == api/migrations/*.js ]]; then MIGS+=("$(basename "$path")"); fi ;;
  esac
  case "$path" in api/*) NEED_API=1 ;; app/*) NEED_WEB=1 ;; esac
done < <(git diff --name-status --no-renames "$PREV" HEAD)

SERVICES=(); [ "$NEED_API" = 1 ] && SERVICES+=(api); [ "$NEED_WEB" = 1 ] && SERVICES+=(web)
[ "${#SERVICES[@]}" -gt 0 ] || { say "Only docs/tests changed between $PREV and $SHORT - nothing to deploy."; exit 0; }
SVC_CSV=$(IFS=,; echo "${SERVICES[*]}")

if [ -n "$(git diff --name-only "$PREV" HEAD -- docker-compose.yml .env.production.example)" ]; then
  warn "docker-compose.yml / .env.production.example changed - this script does NOT deploy them; review and copy by hand."
fi

# ---------------------------------------------------------------- deploy: tests
if [ "$SKIP_TESTS" = 1 ]; then say "(tests skipped)"
elif [ "$DRY" = 1 ]; then say "(dry-run: lint + tests would run here)"
else
  say "== lint + tests"
  (cd api && npm run lint && npm test) || die "lint/tests failed - not deploying"
fi

# ---------------------------------------------------------------- deploy: drift check
if [ "$UP" = 1 ]; then
  CHECK=("${FILES[@]}" "${REMOVED[@]}")
  if [ "${#CHECK[@]}" -gt 0 ]; then
    for f in "${CHECK[@]}"; do
      if git cat-file -e "$PREV:$f" 2> /dev/null; then echo "$(git show "$PREV:$f" | tr -d '\r' | md5sum | cut -c1-32) $f"; else echo "NEW $f"; fi
    done > /tmp/deploy-local-$$.txt
    ssh "${SSH_OPTS[@]}" "$TARGET" bash -s -- "${CHECK[@]}" > /tmp/deploy-server-$$.txt << 'REMOTE' || true
cd ~/fintech || exit 1
for f in "$@"; do
  if [ -f "$f" ]; then echo "$(tr -d '\r' < "$f" | md5sum | cut -c1-32) $f"; else echo "NEW $f"; fi
done
REMOTE
    if ! diff -q /tmp/deploy-local-$$.txt /tmp/deploy-server-$$.txt > /dev/null; then
      say "Files that differ from commit $PREV on the server:"
      diff /tmp/deploy-local-$$.txt /tmp/deploy-server-$$.txt | grep '^>' | sed 's/^> /  /' || true
      [ "$FORCE" = 1 ] && warn "--force: overwriting them" || must "someone changed these files on the server; look at them (or use --force)"
    else
      say "Server files match $PREV - safe to overwrite."
    fi
    rm -f /tmp/deploy-local-$$.txt /tmp/deploy-server-$$.txt
  fi
fi

# ---------------------------------------------------------------- deploy: plan
say ""
say "Deploy plan"
say "  from      : $PREV   to: $SHORT   ($(git log --oneline "$PREV..HEAD" | wc -l | tr -d ' ') commits)"
say "  changed   : ${#FILES[@]} files, ${#REMOVED[@]} removed"
say "  rebuild   : ${SERVICES[*]}"
say "  migrations: ${MIGS[*]:-none}"
say "  rollback  : $([ "$AUTO" = 1 ] && echo 'automatic if the health check fails' || echo 'manual only') (scripts/deploy.sh rollback)"
say "  target    : $TARGET"
if [ "$DRY" = 1 ]; then say ""; say "Dry run - nothing was changed."; exit 0; fi
if [ "$YES" != 1 ]; then read -r -p "Deploy to production? [y/N] " a; [ "$a" = y ] || [ "$a" = Y ] || die "cancelled"; fi

# ---------------------------------------------------------------- deploy: upload + run
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
if [ "${#FILES[@]}" -gt 0 ]; then git -c core.autocrlf=false archive --format=tar -o "$TMP/payload.tar" HEAD -- "${FILES[@]}"; else tar -cf "$TMP/payload.tar" -T /dev/null; fi
printf '%s\n' "${FILES[@]:-}" | sed '/^$/d' > "$TMP/files.txt"
printf '%s\n' "${REMOVED[@]:-}" | sed '/^$/d' > "$TMP/removed.txt"
printf '%s\n' "${MIGS[@]:-}" | sed '/^$/d' > "$TMP/migrations.txt"
tr -d '\r' < scripts/remote-deploy.sh > "$TMP/remote-deploy.sh"
tr -d '\r' < scripts/remote-rollback.sh > "$TMP/fintech-rollback.sh"

say "== uploading to $TARGET:~/deploys/$SHORT"
rssh "mkdir -p ~/deploys/$SHORT && rm -f ~/deploys/$SHORT/result"
rscp "$TMP/payload.tar" "$TMP/files.txt" "$TMP/removed.txt" "$TMP/migrations.txt" "$TMP/remote-deploy.sh" "$TARGET:deploys/$SHORT/"
rscp "$TMP/fintech-rollback.sh" "$TARGET:fintech-rollback.sh"
rssh "nohup bash ~/deploys/$SHORT/remote-deploy.sh $SHORT $PREV $SVC_CSV $AUTO > ~/deploys/$SHORT/deploy.log 2>&1 < /dev/null & echo started"

OFF=0; RES=""; END=$((SECONDS + 1800))
while [ "$SECONDS" -lt "$END" ]; do
  OUT=$(rssh "tail -n +$((OFF + 1)) ~/deploys/$SHORT/deploy.log 2>/dev/null; echo @@RESULT@@\$(cat ~/deploys/$SHORT/result 2>/dev/null)") || { sleep 10; continue; }
  BODY=${OUT%@@RESULT@@*}; RES=${OUT##*@@RESULT@@}
  printf '%s' "$BODY"; OFF=$((OFF + $(printf '%s' "$BODY" | wc -l)))
  [ -n "$RES" ] && break
  sleep 10
done

case "$RES" in
  OK)           say ""; say "Deployed $SHORT. Roll back with: scripts/deploy.sh rollback" ;;
  ROLLED_BACK)  die "the new version was not healthy - rolled back automatically to $PREV" ;;
  FAILED_BUILD) die "build failed on the server - nothing was restarted (log: ~/deploys/$SHORT/build.log)" ;;
  "")           die "timed out waiting for the server - check ~/deploys/$SHORT/deploy.log" ;;
  *)            die "deploy ended with '$RES' - check ~/deploys/$SHORT/deploy.log and 'scripts/deploy.sh status'" ;;
esac
