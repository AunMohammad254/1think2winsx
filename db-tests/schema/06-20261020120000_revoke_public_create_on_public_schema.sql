-- Applied to production (Mumbai, eclivawqhdovsndlngfo) on 2026-10-21 as 20261021113231, with the owner's
-- approval. The schema ACL afterwards: postgres=UC, PUBLIC/anon/authenticated/service_role=U.
-- Every role could create objects in schema public, the anon API role included. The schema's ACL,
-- read on 2026-10-20, was {postgres=UC/postgres,=UC/postgres,authenticated=U/postgres}: PUBLIC still
-- had CREATE, the default before Postgres 15, which pg_upgrade keeps. A role that can create in
-- public can plant a table, view or function there that shadows a name other roles resolve through
-- search_path. Only postgres (the schema owner, which runs migrations) and supabase_admin create
-- objects in public: every object there is owned by postgres, and no function body runs DDL.

-- anon and service_role had USAGE only through PUBLIC. The revoke below leaves PUBLIC's USAGE in
-- place, but grant it to the API roles by name, as a new Supabase project does, so their access no
-- longer depends on PUBLIC.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
