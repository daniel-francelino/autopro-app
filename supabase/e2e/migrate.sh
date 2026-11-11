#!/usr/bin/env bash
# Aplica as migrations do app na stack de teste, depois que Auth e Storage criaram os próprios schemas.
# Idempotente: guarda o que já rodou em public._e2e_migrations (a stack pode ser reaproveitada sem "down -v").
set -euo pipefail

export PGPASSWORD="${POSTGRES_PASSWORD}"
PSQL=(psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q)

echo "[migrate] esperando auth.users e storage.buckets..."
for _ in $(seq 1 90); do
  ready=$("${PSQL[@]}" -At -c "SELECT to_regclass('auth.users') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL" 2>/dev/null || echo f)
  [ "$ready" = "t" ] && break
  sleep 2
done
[ "${ready:-f}" = "t" ] || { echo "[migrate] Auth/Storage não criaram seus schemas a tempo" >&2; exit 1; }

"${PSQL[@]}" -c "CREATE TABLE IF NOT EXISTS public._e2e_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"

# Uma única consulta traz as já aplicadas (em vez de um psql por arquivo).
applied_names=$("${PSQL[@]}" -At -c "SELECT name FROM public._e2e_migrations")  # falha aqui derruba o script (set -e)
declare -A already
while IFS= read -r n; do
  [ -n "$n" ] && already["$n"]=1
done <<< "$applied_names"

applied=0
for file in /migrations/*.sql; do
  name=$(basename "$file")
  [ -n "${already[$name]:-}" ] && continue
  echo "[migrate] $name"
  # Uma transação por arquivo, como o Supabase CLI (a 091 usa tabela temporária ON COMMIT DROP).
  "${PSQL[@]}" --single-transaction -f "$file" -c "INSERT INTO public._e2e_migrations (name) VALUES ('$name')"
  applied=$((applied + 1))
done

# Dados de referência opcionais da stack (ex.: ações de permissão — KF-21), na ordem do nome.
if [ -d /seed ]; then
  for file in /seed/*.sql; do
    [ -e "$file" ] || continue
    echo "[seed] $(basename "$file")"
    "${PSQL[@]}" -f "$file"
  done
fi

"${PSQL[@]}" -c "NOTIFY pgrst, 'reload schema'"
echo "[migrate] pronto ($applied migrations novas)"
