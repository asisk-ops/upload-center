-- =====================================================================
-- CallSource Data Upload Center — Supabase schema
-- Run this whole file once in Supabase: SQL Editor → New query → Run.
-- Safe to re-run: it drops and recreates its own policies and triggers.
-- Everything is prefixed du_ so it can share a Supabase project with other apps.
-- =====================================================================

-- Who counts as "the team": anyone signed in with a @callsourceauto.com email.
-- To change or add a domain, edit this function and re-run it.
create or replace function public.du_is_team()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@callsourceauto.com'
$$;

-- ---------- Tables ----------
create table if not exists public.du_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text unique not null,
  full_name   text,
  created_at  timestamptz not null default now()
);

create table if not exists public.du_uploads (
  id                  uuid primary key default gen_random_uuid(),
  dealer              text not null,
  list_type           text,
  status              text not null default 'Expected'
                      check (status in ('Expected','Received','Issues','Ready','Loaded')),
  received_on         date,          -- the day the dealer's list came in
  uploaded_on         date,          -- the day it was loaded
  due_on              date,          -- expected-by date while waiting on the dealer
  row_count           integer check (row_count >= 0),
  issue_count         integer check (issue_count >= 0),
  file_name           text,
  owner_id            uuid references public.du_profiles (id) on delete set null,
  notes               text,
  source              text not null default 'manual' check (source in ('manual','hubspot','checker')),
  hubspot_ticket_id   text unique,
  hubspot_ticket_name text,
  hubspot_owner       text,
  hubspot_created_at  timestamptz,
  hubspot_in_stage    boolean,
  created_by          uuid references public.du_profiles (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists du_uploads_status_idx   on public.du_uploads (status);
create index if not exists du_uploads_received_idx on public.du_uploads (received_on desc);

create table if not exists public.du_upload_events (
  id          bigint generated always as identity primary key,
  upload_id   uuid not null references public.du_uploads (id) on delete cascade,
  actor_id    uuid references public.du_profiles (id) on delete set null,
  action      text not null,         -- created | status | uploaded | edited | hubspot
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists du_upload_events_upload_idx on public.du_upload_events (upload_id, created_at desc);

create table if not exists public.du_sync_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  found       integer,
  created     integer,
  error       text
);

-- ---------- New sign-ups: team emails only, then create a profile ----------
create or replace function public.du_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Only team emails get an Upload Center profile. Other sign-ups (for example
  -- another app sharing this Supabase project) pass through untouched.
  if new.email is null or new.email not ilike '%@callsourceauto.com' then
    return new;
  end if;
  insert into public.du_profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;  -- never block a sign-up
end $$;
-- Team members who already have an account in this project get a profile now.
insert into public.du_profiles (id, email, full_name)
select id, email, nullif(raw_user_meta_data ->> 'full_name', '')
from auth.users where email ilike '%@callsourceauto.com'
on conflict (id) do nothing;

drop trigger if exists du_on_auth_user_created on auth.users;
create trigger du_on_auth_user_created after insert on auth.users
  for each row execute function public.du_handle_new_user();

-- ---------- Keep updated_at fresh and write the activity log ----------
create or replace function public.du_uploads_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists du_uploads_touch on public.du_uploads;
create trigger du_uploads_touch before update on public.du_uploads
  for each row execute function public.du_uploads_touch();

create or replace function public.du_uploads_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into du_upload_events (upload_id, actor_id, action, detail)
    values (new.id, auth.uid(), case when new.source = 'hubspot' then 'hubspot' else 'created' end,
            jsonb_build_object('status', new.status, 'source', new.source));
  else
    if new.status is distinct from old.status then
      insert into du_upload_events (upload_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'status', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.uploaded_on is distinct from old.uploaded_on then
      insert into du_upload_events (upload_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'uploaded', jsonb_build_object('from', old.uploaded_on, 'to', new.uploaded_on));
    end if;
    if (new.dealer, new.list_type, new.received_on, new.due_on, new.row_count, new.issue_count,
        new.file_name, new.owner_id, new.notes)
       is distinct from
       (old.dealer, old.list_type, old.received_on, old.due_on, old.row_count, old.issue_count,
        old.file_name, old.owner_id, old.notes)
       and auth.uid() is not null then
      insert into du_upload_events (upload_id, actor_id, action, detail)
      values (new.id, auth.uid(), 'edited', '{}'::jsonb);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists du_uploads_log on public.du_uploads;
create trigger du_uploads_log after insert or update on public.du_uploads
  for each row execute function public.du_uploads_log();

-- ---------- Row-level security: team members only ----------
alter table public.du_profiles      enable row level security;
alter table public.du_uploads       enable row level security;
alter table public.du_upload_events enable row level security;
alter table public.du_sync_runs     enable row level security;

drop policy if exists "team reads profiles"   on public.du_profiles;
drop policy if exists "edit own profile"      on public.du_profiles;
drop policy if exists "team reads uploads"    on public.du_uploads;
drop policy if exists "team adds uploads"     on public.du_uploads;
drop policy if exists "team edits uploads"    on public.du_uploads;
drop policy if exists "team deletes uploads"  on public.du_uploads;
drop policy if exists "team reads activity"   on public.du_upload_events;
drop policy if exists "team reads sync runs"  on public.du_sync_runs;

create policy "team reads profiles"  on public.du_profiles      for select to authenticated using (public.du_is_team());
create policy "edit own profile"     on public.du_profiles      for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "team reads uploads"   on public.du_uploads       for select to authenticated using (public.du_is_team());
create policy "team adds uploads"    on public.du_uploads       for insert to authenticated with check (public.du_is_team());
create policy "team edits uploads"   on public.du_uploads       for update to authenticated using (public.du_is_team()) with check (public.du_is_team());
create policy "team deletes uploads" on public.du_uploads       for delete to authenticated using (public.du_is_team());
create policy "team reads activity"  on public.du_upload_events for select to authenticated using (public.du_is_team());
create policy "team reads sync runs" on public.du_sync_runs     for select to authenticated using (public.du_is_team());

-- ---------- Live updates in the browser ----------
do $$ begin
  begin alter publication supabase_realtime add table public.du_uploads;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.du_upload_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.du_sync_runs;     exception when duplicate_object then null; end;
end $$;

-- =====================================================================
-- HubSpot auto-sync schedule (run AFTER the upload-center-sync function is deployed)
-- 1. Replace YOUR-PROJECT-REF and YOUR-ANON-KEY below (Project Settings → API).
-- 2. Select just this block and click Run.
-- =====================================================================
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.unschedule('du-hubspot-sync') where exists (select 1 from cron.job where jobname = 'du-hubspot-sync');
-- select cron.schedule(
--   'du-hubspot-sync',
--   '*/15 * * * *',
--   $job$
--   select net.http_post(
--     url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/upload-center-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                                   'Authorization', 'Bearer YOUR-ANON-KEY'),
--     body    := '{}'::jsonb
--   );
--   $job$
-- );
