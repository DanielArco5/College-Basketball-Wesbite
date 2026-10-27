-- ============================================================
-- Daily automation: news feed, ranking snapshots, hand-set Top 25 picks
-- Run once in the Supabase SQL editor. Safe to rerun.
-- ============================================================
--
-- Three things the daily GitHub Action (.github/workflows/daily.yml)
-- and the site need:
--
--   1. live_wire_entries.source: which outlet an auto-fetched headline
--      came from (ESPN, CBS Sports). Hand-written entries leave it null.
--   2. formula_snapshots: one copy of the formula's output per day.
--      scripts/project-2027.ts writes it; the rankings read the newest,
--      so a daily re-rank shows up without a redeploy. Older days stay
--      as history.
--   3. top25_overrides: your hand edits to the Top 25. Add a row in the
--      Table Editor and the site picks it up within five minutes.
--
-- All three are read only by the server (secret key), so RLS is on with
-- no public policies: the browser can't read or write them directly.


-- ── 1. Live Wire source ───────────────────────────────────────────────

alter table live_wire_entries add column if not exists source text;

-- The news fetcher skips anything whose link is already in the table.
create index if not exists live_wire_url_idx on live_wire_entries (url);


-- ── 2. Daily formula snapshots ────────────────────────────────────────

create table if not exists formula_snapshots (
  season       int  not null,
  day          date not null,
  generated_at timestamptz not null default now(),
  data         jsonb not null,
  primary key (season, day)
);

alter table formula_snapshots enable row level security;
revoke all on formula_snapshots from anon, authenticated;
grant all on formula_snapshots to service_role;


-- ── 3. Hand-set Top 25 ────────────────────────────────────────────────
--
-- One row per team you want to place yourself:
--   school     exactly as the site spells it (UConn, St. John's, Miami)
--   rank       1-35 puts the team at that spot (26-35 are the honorable
--              mentions); 0 takes it out of the list entirely
--   note       optional; shown when someone hovers the "Our pick" tag
--   is_active  uncheck to switch a pick off without deleting it
--
-- Every team you don't pin keeps the formula's order around your picks,
-- and the formula still re-ranks them every day.

create table if not exists top25_overrides (
  id         bigint generated always as identity primary key,
  school     text not null check (length(trim(school)) > 0),
  rank       int  not null check (rank between 0 and 35),
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table top25_overrides enable row level security;
revoke all on top25_overrides from anon, authenticated;
grant all on top25_overrides to service_role;

notify pgrst, 'reload schema';


-- ── Checks ─────────────────────────────────────────────────────────
-- Run separately.
--
-- Pin UConn at No. 3 (then reload /rankings within five minutes):
--   insert into top25_overrides (school, rank, note)
--   values ('UConn', 3, 'Hurley teams always get there');
--
-- Undo it:
--   update top25_overrides set is_active = false where school = 'UConn';
--
-- Newest snapshot:
--   select season, day, generated_at from formula_snapshots
--   order by generated_at desc limit 5;
