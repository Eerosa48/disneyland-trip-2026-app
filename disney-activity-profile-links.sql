-- Greyson's Disney Trip: optional, administrator-managed visitor profile links.
-- This table NEVER replaces activity_visitors or alters existing session / event records.
-- Service-role Edge Function access only; anon/authenticated have no direct policies.

create table if not exists public.activity_visitor_profile_links (
  visitor_id uuid primary key references public.activity_visitors(visitor_id) on delete cascade,
  group_id uuid not null,
  group_label text null check (group_label is null or (char_length(trim(group_label)) between 1 and 80)),
  updated_at timestamptz not null default now()
);

create index if not exists activity_visitor_profile_links_group_id_idx
  on public.activity_visitor_profile_links (group_id);

alter table public.activity_visitor_profile_links enable row level security;
revoke all on public.activity_visitor_profile_links from anon, authenticated;
grant select, insert, update, delete on public.activity_visitor_profile_links to service_role;
-- No RLS policies: client-side Supabase sessions cannot access these associations.
