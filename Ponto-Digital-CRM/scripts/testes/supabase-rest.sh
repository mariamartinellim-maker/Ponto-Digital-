#!/bin/bash
# Valida a persistência dos módulos operacionais no modo Supabase, sem tocar no projeto real:
# PostgreSQL local + PostgREST (a mesma API usada pelo supabase-js) + RLS das migrações.
# Requisitos: PostgreSQL 15+ local (usuário postgres) e o binário do PostgREST em POSTGREST_BIN.
#   POSTGREST_BIN=/caminho/postgrest bash scripts/testes/supabase-rest.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=pdcrm_rest
PORT=${PGRST_PORT:-3999}
SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
su postgres -c "dropdb --if-exists $DB && createdb $DB"
su postgres -c "psql -q -d $DB -f supabase/tests/rest-setup.sql" >/dev/null
CONF=$(mktemp)
cat > "$CONF" <<CFG
db-uri = "postgres://authenticator:senha-local-de-teste@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = $PORT
server-host = "127.0.0.1"
CFG
"${POSTGREST_BIN:?defina POSTGREST_BIN}" "$CONF" > /tmp/postgrest-teste.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$CONF"' EXIT
for i in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.3; done
PGRST_URL="http://127.0.0.1:$PORT" PGRST_JWT_SECRET="$SECRET" npx vitest run tests/supabase-rest.test.ts
