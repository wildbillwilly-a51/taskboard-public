#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
previous=${1:-}
restore=${2:-false}
if [[ -n "$previous" ]]; then
  if [[ ! "$previous" =~ ^[0-9a-f]{40}$ ]] || ! git merge-base --is-ancestor "$previous" HEAD; then
    echo "Use the full commit ID of a previous public revision in this checkout's history." >&2
    exit 1
  fi
fi
if [[ "$restore" != true && "$restore" != false ]]; then
  echo "The restore argument must be true or false." >&2
  exit 1
fi

umask 077
scratch=$(mktemp -d)
project="taskboard-release-check-$(openssl rand -hex 6)"
source_dir=$root
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_SECRET=$(openssl rand -hex 32)
TASKBOARD_CHECK_PASSWORD=$(openssl rand -hex 24)
export POSTGRES_PASSWORD AUTH_SECRET TASKBOARD_CHECK_PASSWORD
export TASKBOARD_PORT=0 TASKBOARD_BIND_ADDRESS=127.0.0.1 AUTH_COOKIE_SECURE=false
export TASKBOARD_OIDC_ISSUER= TASKBOARD_OIDC_CLIENT_ID= TASKBOARD_OIDC_CLIENT_SECRET= TASKBOARD_OIDC_CALLBACK_URL=
export COMPOSE_PROFILES=

compose() {
  docker compose --env-file /dev/null --project-name "$project" \
    --file "$source_dir/compose.standalone.yaml" "$@"
}

cleanup() {
  local status=$?
  if (( status != 0 )); then
    compose logs --no-color --tail 80 db app >&2 || true
  fi
  compose down --volumes --remove-orphans || status=1
  rm -rf -- "$scratch"
  exit "$status"
}
trap cleanup EXIT

start_app() {
  compose build app
  local image_id running_image
  image_id=$(docker image inspect --format '{{.Id}}' "${project}-app")
  compose up -d --wait --wait-timeout 120
  running_image=$(docker inspect --format '{{.Image}}' "$(compose ps -q app)")
  if [[ "$running_image" != "$image_id" ]]; then
    echo "Expected image $image_id but found $running_image." >&2
    exit 1
  fi
  echo "Running image $image_id."
}

fixture() {
  local address
  address=$(compose port app 3000)
  node "$root/scripts/standalone-fixture.mjs" "$1" "http://$address" "$scratch/fixture.json"
}

function_privileges() {
  compose exec -T db psql -X -A -t -v ON_ERROR_STOP=1 -U taskboard taskboard \
    -c "SELECT p.oid::regprocedure::text, COALESCE(p.proacl::text, '<default>'),
        EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1"
}

if [[ -n "$previous" ]]; then
  source_dir="$scratch/previous"
  mkdir "$source_dir"
  git archive "$previous" | tar -x -C "$source_dir"
  echo "Preparing upgrade fixture on public revision $previous."
  start_app
  fixture seed
  compose down
  source_dir=$root
  echo "Starting candidate on the existing database and uploads volumes."
  start_app
  fixture verify
  if git diff --quiet "$previous" HEAD -- db/migrations db/baseline; then
    echo "Existing-volume upgrade rehearsal passed. The recorded schema is unchanged since $previous."
  else
    echo "Existing-volume upgrade rehearsal passed with schema changes."
  fi
else
  echo "Checking a fresh standalone install."
  start_app
  fixture seed
fi

if [[ "$restore" == true ]]; then
  compose stop app
  function_privileges > "$scratch/permissions.before"
  test -s "$scratch/permissions.before"
  if grep -E '\|t$' "$scratch/permissions.before"; then
    echo "A public schema SECURITY DEFINER function grants execution to PUBLIC." >&2
    exit 1
  fi
  compose exec -T db pg_dump -U taskboard --no-owner taskboard > "$scratch/taskboard.sql"
  compose run --rm --no-deps -T --entrypoint tar app -czf - -C /app/uploads . > "$scratch/uploads.tar.gz"
  compose down --volumes
  compose up -d --wait --wait-timeout 120 db
  compose exec -T db psql -X -v ON_ERROR_STOP=1 -U taskboard taskboard < "$scratch/taskboard.sql"
  compose run --rm --no-deps -T --entrypoint tar app -xzf - -C /app/uploads < "$scratch/uploads.tar.gz"
  compose up -d --wait --wait-timeout 120
  function_privileges > "$scratch/permissions.after"
  diff -u "$scratch/permissions.before" "$scratch/permissions.after"
  fixture verify
  echo "Backup restored into empty volumes with function permissions preserved."
fi
