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
-- 1b. Conversations keyed by user id
-- ------------------------------------------------------------
-- The kv snapshot is last-write-wins across the whole app: one instance
-- pushing a stale blob erases everyone else's chats. Each conversation is
-- its own row, filtered by user_id, so a cold start can load *this* person's
-- history without adopting (or overwriting) anyone else's.

create table if not exists buildwe_conversations (
  id          text primary key,
  user_id     text not null,
  team_id     text,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists buildwe_conversations_user_idx
  on buildwe_conversations (user_id, updated_at desc);

create index if not exists buildwe_conversations_team_idx
  on buildwe_conversations (team_id)
  where team_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buildwe_conversations_id_len_ck'
  ) then
    alter table buildwe_conversations
      add constraint buildwe_conversations_id_len_ck
      check (length(id) between 1 and 80 and length(user_id) between 1 and 80);
  end if;
end $$;

alter table buildwe_conversations enable row level security;

drop policy if exists "deny all to anon" on buildwe_conversations;
create policy "deny all to anon"
  on buildwe_conversations for all
  to anon, authenticated
  using (false)
  with check (false);


-- ------------------------------------------------------------
-- 1c. Owner-scoped rows (accounts, projects, billing)
-- ------------------------------------------------------------
-- The kv snapshot is still a last-write-wins document for leftover collections.
-- Accounts, projects, payments and wallets must not live only in that blob:
-- one cold instance pushing an empty snapshot would erase someone else's PRO
-- status. Each of these is its own row, filtered by user_id.

create table if not exists buildwe_owned (
  kind        text not null,
  id          text not null,
  user_id     text not null,
  payload     jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (kind, id)
);

create index if not exists buildwe_owned_user_idx
  on buildwe_owned (kind, user_id, updated_at desc);

-- Email login on a cold instance filters on payload->>'email', which no index
-- covered: every login attempt sequentially scanned all of buildwe_owned
-- (users + projects + payments + wallets). That path is reachable before
-- authentication, so it was also a cheap way to load the database. Partial,
-- because only account rows carry an email.
create index if not exists buildwe_owned_email_idx
  on buildwe_owned ((payload->>'email'))
  where kind = 'user';

-- Only the four kinds the application knows about. A typo in a future writer
-- would otherwise create a silently unreadable partition of rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buildwe_owned_kind_ck'
  ) then
    alter table buildwe_owned
      add constraint buildwe_owned_kind_ck
      check (kind in ('user', 'project', 'payment', 'wallet', 'credit'));
  end if;
end $$;

-- Ids are generated server-side and already length-checked in the app; this is
-- the same rule expressed where it cannot be bypassed.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buildwe_owned_id_len_ck'
  ) then
    alter table buildwe_owned
      add constraint buildwe_owned_id_len_ck
      check (length(id) between 1 and 80 and length(user_id) between 1 and 80);
  end if;
end $$;

alter table buildwe_owned enable row level security;

drop policy if exists "deny all to anon" on buildwe_owned;
create policy "deny all to anon"
  on buildwe_owned for all
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

-- A negative counter would mean unlimited quota. The function never writes one;
-- this makes that impossible rather than merely unlikely.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'buildwe_rate_limits_count_ck'
  ) then
    alter table buildwe_rate_limits
      add constraint buildwe_rate_limits_count_ck check (count >= 0);
  end if;
end $$;

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
-- Pin the resolution path. Without this the function resolves
-- buildwe_rate_limits and make_interval against the CALLER's search_path, so
-- anyone who can create objects in an earlier schema could shadow them. Cheap,
-- standard hardening for every Postgres function.
set search_path = public, pg_temp
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
set search_path = public, pg_temp
as $$
  delete from buildwe_rate_limits where reset_at < now() - interval '1 day';
$$;

-- ------------------------------------------------------------
-- 2b. Schedule the cleanup (pg_cron)
-- ------------------------------------------------------------
-- Without a schedule the function above is dead code and buildwe_rate_limits
-- grows forever: one row per identity per bucket, never reclaimed. pg_cron is
-- the in-database scheduler and ships enabled on every Supabase plan, so this
-- adds no external service and no second bill.
--
-- SCHEDULE: 'buildwe-rate-cleanup' runs daily at 03:17 UTC.
--   Off-peak, and deliberately not on the hour — every other system in the
--   world schedules at :00, and this is a lock-taking DELETE.
--
-- Idempotent twice over: the whole block is skipped when pg_cron is not
-- installed, and cron.schedule() with a job NAME updates the existing job
-- rather than creating a duplicate, so re-running this file cannot stack jobs.
--
-- Inspect:   select jobname, schedule, active from cron.job;
-- History:   select jobname, status, start_time from cron.job_run_details
--              where jobname = 'buildwe-rate-cleanup' order by start_time desc;
-- Remove:    select cron.unschedule('buildwe-rate-cleanup');
--
-- If pg_cron is unavailable, nothing here fails — but the table will not be
-- pruned, so enable it (Dashboard → Database → Extensions → pg_cron) and
-- re-run this file.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'buildwe-rate-cleanup',
      '17 3 * * *',
      $job$select public.buildwe_rate_cleanup();$job$
    );
  else
    raise notice
      'pg_cron is not installed - buildwe_rate_cleanup() is NOT scheduled. Enable pg_cron and re-run this file.';
  end if;
end $$;


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
-- This whole script is safe to run more than once — every statement is
-- idempotent, so re-running it after a change will not error or lose data.
--
-- Expect: buildwe_kv, buildwe_conversations, buildwe_owned, buildwe_rate_limits, and a buildwe-media bucket.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name like 'buildwe%'
order by table_name;
