-- Clears the security advisor warnings before the site goes public.
--
-- Triage, because "critical" is the severity for the class and not a
-- judgment about this database:
--
--   Security Definer View — a view without security_invoker runs as its
--   owner, so RLS on the tables underneath is bypassed. Every view here
--   is over public reference data, so the real exposure is close to
--   nothing. Still worth fixing: the warning costs nothing to clear and
--   the behaviour is surprising to anyone reading the schema later.
--
--   Function Search Path Mutable — a function without a pinned
--   search_path can be hijacked by someone who can create objects in an
--   earlier schema. Nobody can here. One line each to close.
--
--   Materialized View in API — expected. Matviews can't carry RLS, so
--   every one exposed through PostgREST gets flagged. These hold public
--   data deliberately, with one exception handled at the bottom.
--
-- SAFE TO RUN: the app reads through the secret key server-side, which
-- bypasses RLS entirely, so switching these views to invoker rights does
-- not change what any page can see.

-- ── Views: run as the caller, not the owner ────────────────────────

alter view team_colors               set (security_invoker = on);
alter view api_usage_this_month      set (security_invoker = on);
alter view team_season_totals        set (security_invoker = on);
alter view team_defense_season_totals set (security_invoker = on);
alter view team_ratings              set (security_invoker = on);

-- If the advisor lists others, add them here in the same shape. The
-- statement is idempotent, so re-running costs nothing.


-- ── Functions: pin the search path ─────────────────────────────────
-- pg_temp goes last so a temporary object can never shadow a real one.

alter function zone_of(double precision, double precision)
  set search_path = public, pg_temp;

alter function refresh_adjusted_ratings(int, int)
  set search_path = public, pg_temp;

-- If either errors with "function does not exist", the argument types
-- differ from what's written here. Find the real signature with:
--   select oid::regprocedure from pg_proc
--   where proname in ('zone_of','refresh_adjusted_ratings');
-- then paste that signature in place of the one above.


-- ── The one that actually matters ──────────────────────────────────
-- api_usage_this_month is the CBBD quota ledger. It isn't dangerous,
-- but there's no reason for the public to read how many API calls this
-- project has made. The app reads it through the secret key, which is
-- unaffected by this.

revoke select on api_usage_this_month from anon, authenticated;
revoke select on api_calls             from anon, authenticated;

-- Same reasoning for the ingest archive and checkpoints, if they're
-- exposed. Raw payloads and job state aren't site content.
revoke select on ingest_raw         from anon, authenticated;
revoke select on ingest_checkpoints from anon, authenticated;

notify pgrst, 'reload schema';


-- ── Check ──────────────────────────────────────────────────────────
-- Re-run the advisor in the dashboard. Expect the definer-view and
-- search-path warnings to clear, and the matview-in-API notices to
-- remain — those are correct and intended.
--
-- Then load /, /shot-chart and /rankings. All three should be
-- unchanged. If anything broke, it means that page was reading through
-- the public key rather than the secret one, which is worth knowing on
-- its own.
