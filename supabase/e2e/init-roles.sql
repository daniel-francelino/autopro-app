-- Roda uma única vez na criação do banco da stack de teste (docker-entrypoint-initdb.d).
-- A imagem supabase/postgres cria os papéis internos sem senha utilizável; Auth, Storage e PostgREST
-- entram por eles, então todos recebem POSTGRES_PASSWORD (o mesmo que o compose oficial do Supabase faz).
\set pgpass `echo "$POSTGRES_PASSWORD"`

SELECT format('ALTER ROLE %I WITH PASSWORD %L', rolname, :'pgpass')
FROM pg_roles
WHERE rolname IN ('authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_functions_admin', 'supabase_storage_admin')
\gexec
