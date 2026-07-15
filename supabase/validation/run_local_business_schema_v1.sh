#!/usr/bin/env bash

# Runs the complete business schema v1 flow against a disposable local
# PostgreSQL cluster. It never starts a server, opens a socket, connects to a
# remote host, or needs secrets.

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(pg_config --bindir)}"
CLUSTER_DIR="${PDMU_PG_TMPDIR:-$(mktemp -d /tmp/pdmu-business-v1-e2e-XXXXXX)}"
DATA_DIR="$CLUSTER_DIR/data"
LOG_DIR="$CLUSTER_DIR/logs"

for binary in initdb postgres; do
  if [[ ! -x "$PG_BIN/$binary" ]]; then
    echo "ERROR: missing $PG_BIN/$binary" >&2
    exit 1
  fi
done

run_sql() {
  local label="$1"
  local file="$2"
  local log="$LOG_DIR/$label.log"

  # The single-user backend treats a physical newline as a query delimiter.
  # Known repo scripts contain only full-line SQL comments, so those are
  # removed and the complete file is sent as one line. PostgreSQL's SQL parser
  # still handles semicolons, transactions and dollar-quoted PL/pgSQL bodies.
  sed '/^[[:space:]]*--/d' "$file" \
    | tr '\n' ' ' \
    | "$PG_BIN/postgres" --single -D "$DATA_DIR" postgres >"$log" 2>&1

  # postgres --single may exit zero after a SQL error. Treat server error
  # markers as authoritative and never report a false PASS.
  if grep -En 'ERROR:|FATAL:|PANIC:' "$log"; then
    echo "$label | FAIL | $log" >&2
    return 1
  fi

  echo "$label | PASS"
  grep -En 'PASS|COMMIT|ROLLBACK' "$log" | tail -5 || true
}

mkdir -p "$CLUSTER_DIR" "$LOG_DIR"
"$PG_BIN/initdb" \
  -D "$DATA_DIR" \
  --auth=trust \
  --no-locale \
  --encoding=UTF8 >/dev/null

# Supabase provides these objects. This minimal local stub exists only so the
# migration can validate its foreign keys and grants in disposable PostgreSQL.
printf '%s\n' \
  'create schema auth; create table auth.users (id uuid primary key); create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;' \
  > "$CLUSTER_DIR/bootstrap.sql"

run_sql bootstrap "$CLUSTER_DIR/bootstrap.sql"
run_sql migration "$ROOT_DIR/supabase/migrations/202606290001_business_schema_v1.sql"
run_sql validation "$ROOT_DIR/supabase/validation/validate_business_schema_v1.sql"
run_sql seed "$ROOT_DIR/supabase/seed/seed_business_schema_v1.sql"
run_sql sanity "$ROOT_DIR/supabase/validation/sanity_checks_business_schema_v1.sql"

printf '%s\n' \
  "select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('operator_profiles','elements','element_documents','payments','attendance_records','audit_log','idempotency_keys') order by c.relname; select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by grantee, table_name order by grantee, table_name;" \
  > "$CLUSTER_DIR/security.sql"
run_sql security "$CLUSTER_DIR/security.sql"

echo "local_validation_complete | PASS"
echo "local_cluster_preserved | $CLUSTER_DIR"
