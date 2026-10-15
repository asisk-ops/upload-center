-- Dealer incentives, copied from the CX Pro incentive Google Sheet by the upload-center-sync function.
-- Run once in Supabase → SQL Editor.
create table if not exists public.du_incentives (
  dealer              text primary key,
  active              text,
  at_risk             text,
  inactive            text,
  other               text,
  expiration          text,
  sheet_row           integer,
  hubspot_company_id  text,
  hubspot_pushed      text,
  updated_at          timestamptz not null default now()
);

alter table public.du_incentives enable row level security;
drop policy if exists "team reads incentives" on public.du_incentives;
create policy "team reads incentives" on public.du_incentives
  for select to authenticated using (public.du_is_team());

-- Live updates in the dashboard when the sheet changes
do $$ begin
  alter publication supabase_realtime add table public.du_incentives;
exception when duplicate_object then null; when undefined_object then null; end $$;
