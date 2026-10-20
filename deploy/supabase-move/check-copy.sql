-- Run on BOTH projects and compare (see SUPABASE_REGION_MOVE.md, Appendix D). One line per check: name, count,
-- fingerprint. Row lines fingerprint every row of every table in public, private_hardened, auth and
-- supabase_migrations, so equal lines mean equal contents. Run it after step 3.4 and BEFORE the link rewrite
-- (step 3.6), which changes Prize, User and LeaderboardCache on purpose.
SET TIME ZONE 'UTC';
with t as (
  select n.nspname as s, c.relname as r
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname in ('public', 'private_hardened', 'auth', 'supabase_migrations')
)
select k, n, h from (
  select 'rows ' || s || '.' || r as k,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', s, r), false, true, '')))[1]::text as n,
    (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) as h from %I.%I x', s, r), false, true, '')))[1]::text as h
  from t
  union all
  select 'functions ' || n.nspname, count(*)::text,
    md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private_hardened') and p.prokind in ('f', 'p') group by n.nspname
  union all
  select 'function privileges ' || n.nspname, count(*)::text,
    md5(string_agg(p.proname || coalesce(p.proacl, acldefault('f'::"char", p.proowner))::text || p.prosecdef::text || coalesce(p.proconfig::text, ''), '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private_hardened') group by n.nspname
  union all
  select 'policies ' || schemaname, count(*)::text,
    md5(string_agg(tablename || policyname || permissive || cmd || roles::text || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
  from pg_policies where schemaname in ('public', 'storage') group by schemaname
  union all
  select 'rls enabled ' || n.nspname, count(*) filter (where c.relrowsecurity)::text,
    md5(string_agg(c.relname || c.relrowsecurity::text || c.relforcerowsecurity::text, '|' order by c.relname))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'private_hardened') group by n.nspname
  union all
  select 'table grants ' || n.nspname, count(*)::text, md5(string_agg(c.relname || coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))::text, '|' order by c.relname))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S') and n.nspname in ('public', 'private_hardened') group by n.nspname
  union all
  select 'columns ' || table_schema, count(*)::text,
    md5(string_agg(table_name || column_name || data_type || coalesce(column_default, '') || is_nullable, '|' order by table_name, ordinal_position))
  from information_schema.columns where table_schema in ('public', 'private_hardened') group by table_schema
  union all
  select 'constraints', count(*)::text, md5(string_agg(conrelid::regclass::text || conname || pg_get_constraintdef(oid), '|' order by conrelid::regclass::text, conname))
  from pg_constraint where connamespace = 'public'::regnamespace
  union all
  select 'indexes', count(*)::text, md5(string_agg(indexdef, '|' order by indexname)) from pg_indexes where schemaname = 'public'
  union all
  select 'views', count(*)::text, md5(string_agg(viewname || definition, '|' order by viewname)) from pg_views where schemaname = 'public'
  union all
  select 'triggers (app)', count(*)::text, string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public', 'auth')
  union all
  select 'realtime publication', count(*)::text, string_agg(schemaname || '.' || tablename, ', ' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'
  union all
  select 'sequences', count(*)::text, string_agg(sequencename || '=' || coalesce(last_value::text, 'null'), ', ' order by sequencename) from pg_sequences where schemaname = 'public'
  union all
  select 'role settings', count(*)::text, string_agg(rolname || ' ' || rolconfig::text, ', ' order by rolname) from pg_roles where rolname in ('anon', 'authenticated', 'authenticator', 'service_role') and rolconfig is not null
  union all
  select 'cron jobs', count(*)::text, string_agg(jobname || ' ' || schedule || ' ' || command, ', ') from cron.job
  union all
  select 'extensions', count(*)::text, string_agg(extname, ', ' order by extname) from pg_extension where extname <> 'plpgsql'
) x order by k;
