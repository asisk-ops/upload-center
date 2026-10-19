-- Let specific people outside @callsourceauto.com use the Upload Center.
-- 1) Put their email on the last part of this script. 2) Run it in SQL Editor.
create table if not exists public.du_extra_members (
  email     text primary key,
  added_at  timestamptz not null default now()
);
alter table public.du_extra_members enable row level security;  -- no policies: only admins in Supabase can see or edit it

-- Team = @callsourceauto.com OR an email on the extra-members list
create or replace function public.du_is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@callsourceauto.com'
      or exists (select 1 from public.du_extra_members m where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

-- New accounts on the list get a dashboard profile too
create or replace function public.du_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or not (new.email ilike '%@callsourceauto.com'
     or exists (select 1 from public.du_extra_members m where lower(m.email) = lower(new.email))) then
    return new;
  end if;
  insert into public.du_profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
exception when others then
  return new;
end $$;

-- ===== Add Vanessa (change the email and name) =====
insert into public.du_extra_members (email) values (lower('vanessa@herdomain.com'))
on conflict (email) do nothing;

-- If her account already exists, give it a profile now
insert into public.du_profiles (id, email, full_name)
select id, email, 'Vanessa'
from auth.users where lower(email) = lower('vanessa@herdomain.com')
on conflict (id) do nothing;
