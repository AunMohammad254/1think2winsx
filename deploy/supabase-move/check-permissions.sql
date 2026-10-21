-- Run on BOTH projects and compare the output line by line (see SUPABASE_REGION_MOVE.md, Appendix D).
-- Every table, view, sequence, function and schema in public and private_hardened, with who may use it.
-- "No explicit grants" is shown as the owner-only default, and grants are sorted, so two ways of writing the same
-- permissions compare equal.
with objs(k, acl) as (
  select 'rel ' || n.nspname || '.' || c.relname,
    coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private_hardened') and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    coalesce(p.proacl, acldefault('f'::"char", p.proowner))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private_hardened')
  union all
  select 'schema ' || nspname, coalesce(nspacl, acldefault('n'::"char", nspowner))
  from pg_namespace where nspname in ('public', 'private_hardened')
  union all
  select 'default grants ' || pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text, d.defaclacl
  from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace
)
select k, (select string_agg(a::text, ',' order by a::text) from unnest(acl) a) from objs
order by 1;
