-- ============================================================
-- BUILDWE — Supabase setup
-- ============================================================
-- Run this ONCE in your Supabase project:
--   Dashboard → SQL Editor → New query → paste all of this → Run
--
-- After it succeeds, add these two values to your deployment env:
--   NEXT_PUBLIC_SUPABASE_URL   = https://<your-project-ref>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY  = Settings → API → service_role key
--
-- The service_role key bypasses RLS by design. It must ONLY ever live in
-- server-side environment variables — never in client code, never in git.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Durable application store
-- ------------------------------------------------------------
-- BUILDWE persists its state as a single JSON document. On serverless hosts
-- the local /tmp directory is wiped when an instance recycles, which loses
-- every account and conversation. This table is what makes the data survive.

create table if not exists buildwe_kv (
  k           text primary key,
  v           jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Row level security on: the service_role key bypasses it, and nothing else
-- should ever reach this table.
alter table buildwe_kv enable row level security;

-- Explicitly deny anonymous and authenticated roles. Without this, a future
-- policy added elsewhere could accidentally widen access.
drop policy if exists "deny all to anon" on buildwe_kv;
create policy "deny all to anon"
  on buildwe_kv for all
  to anon, authenticated
  using (false)
  with check (false);


-- ------------------------------------------------------------
-- 2. Durable rate limiting
-- ------------------------------------------------------------
-- The in-memory limiter resets whenever an instance restarts and is per
-- instance, so on a multi-instance deployment a caller can exceed limits by
-- spreading requests. This table gives every instance one shared counter.
--
-- This is the free alternative to Upstash Redis — it uses the Postgres you
-- already have, so there is no second service and no second bill.

create table if not exists buildwe_rate_limits (
  bucket_key  text primary key,
  count       integer not null default 0,
  reset_at    timestamptz not null,
  updated_at  timestamptz not null default now()
);

create index if not exists buildwe_rate_limits_reset_idx
  on buildwe_rate_limits (reset_at);

alter table buildwe_rate_limits enable row level security;

drop policy if exists "deny all to anon" on buildwe_rate_limits;
create policy "deny all to anon"
  on buildwe_rate_limits for all
  to anon, authenticated
  using (false)
  with check (false);

-- Atomic check-and-increment. Doing this in one statement is what makes the
-- limit correct under concurrency — two simultaneous requests cannot both
-- read "count = 9" and both decide they are allowed.
create or replace function buildwe_rate_hit(
  p_key       text,
  p_limit     integer,
  p_window_ms integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
as $$
declare
  v_now      timestamptz := now();
  v_reset    timestamptz;
  v_count    integer;
begin
  insert into buildwe_rate_limits as r (bucket_key, count, reset_at, updated_at)
  values (p_key, 1, v_now + make_interval(secs => p_window_ms / 1000.0), v_now)
  on conflict (bucket_key) do update
    set
      -- window expired → start a fresh one; otherwise increment
      count = case
                when r.reset_at <= v_now then 1
                else r.count + 1
              end,
      reset_at = case
                   when r.reset_at <= v_now
                     then v_now + make_interval(secs => p_window_ms / 1000.0)
                   else r.reset_at
                 end,
      updated_at = v_now
  returning r.count, r.reset_at into v_count, v_reset;

  return query select
    (v_count <= p_limit),
    greatest(0, p_limit - v_count),
    v_reset;
end;
$$;

-- Housekeeping: drop buckets whose window closed over a day ago.
create or replace function buildwe_rate_cleanup()
returns void
language sql
as $$
  delete from buildwe_rate_limits where reset_at < now() - interval '1 day';
$$;


-- ------------------------------------------------------------
-- 3. Storage bucket for generated media
-- ------------------------------------------------------------
-- Generated images are currently hot-linked from a third party and generated
-- audio lives only in memory, so neither survives. This bucket is where they
-- should be persisted.
--
-- Public read is intentional: these are user-generated images and audio meant
-- to be shared and embedded. Writes are server-side only via service_role.

insert into storage.buckets (id, name, public)
values ('buildwe-media', 'buildwe-media', true)
on conflict (id) do nothing;

drop policy if exists "public read buildwe media" on storage.objects;
create policy "public read buildwe media"
  on storage.objects for select
  to public
  using (bucket_id = 'buildwe-media');


-- ------------------------------------------------------------
-- Verify
-- ------------------------------------------------------------
-- Expect: buildwe_kv, buildwe_rate_limits, and a buildwe-media bucket.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'buildwe%'
order by table_name;
