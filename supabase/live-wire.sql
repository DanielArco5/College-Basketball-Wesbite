-- Live Wire: hand-written news entries for the ticker.
--
-- No feed exists for college basketball transfer news, so this is typed
-- in by hand. That is the honest design: the site shows what someone
-- actually wrote, not a scrape pretending to be a wire service.
--
-- This is the first table with real RLS policies. Everything before it
-- was read-only reference data served through the secret key. Here the
-- public reads published rows and nothing else; writes go through the
-- secret key, which bypasses RLS entirely.

create table if not exists live_wire_entries (
  id          bigint generated always as identity primary key,
  kind        text not null default 'note'
              check (kind in ('transfer','commitment','injury','note')),
  headline    text not null check (length(trim(headline)) > 0),
  detail      text,
  team_id     bigint references teams(id),
  url         text,
  published_at timestamptz not null default now(),
  -- Unpublished rows are drafts. The ticker never sees them.
  is_live     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- The ticker reads live rows newest first; this is the index for that.
create index if not exists live_wire_live_idx
  on live_wire_entries (is_live, published_at desc);

alter table live_wire_entries enable row level security;

-- Anyone can read PUBLISHED entries. Drafts stay invisible.
drop policy if exists live_wire_public_read on live_wire_entries;
create policy live_wire_public_read
  on live_wire_entries
  for select
  to anon, authenticated
  using (is_live = true);

-- No insert/update/delete policy exists on purpose. Without one, RLS
-- denies those operations to anon and authenticated. The secret key
-- bypasses RLS, so writes happen from the server or the SQL editor.

grant select on live_wire_entries to anon, authenticated;
grant all on live_wire_entries to service_role;

notify pgrst, 'reload schema';


-- ── Seed a few rows so the ticker has something to show ────────────
-- Replace these with real entries. They are placeholders, and the
-- ticker renders an empty state cleanly if you delete them instead.

insert into live_wire_entries (kind, headline, is_live) values
  ('note', 'Live Wire is live. Entries added here appear in the ticker.', true)
on conflict do nothing;


-- ── Checks ─────────────────────────────────────────────────────────
-- Run these separately.
--
-- Should return your seeded row:
--   select id, kind, headline, published_at from live_wire_entries
--   where is_live order by published_at desc;
--
-- Confirm RLS actually blocks writes from the public role. This should
-- FAIL with a row-level security violation, which is the point:
--   set role anon;
--   insert into live_wire_entries (headline) values ('should not work');
--   reset role;
