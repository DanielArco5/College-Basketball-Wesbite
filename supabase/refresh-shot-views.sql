-- ============================================================
-- One call to bring every shot-chart summary up to date
-- Run once in the Supabase SQL editor. Safe to rerun.
-- ============================================================
--
-- The shot chart reads materialized views: stored snapshots that don't
-- see new shots until refreshed. scripts/update-shots.ts calls this after
-- each import, so a new season's charts update without anyone opening
-- the SQL editor.
--
-- Order matters: baselines and priors first, then the stats built on
-- them, then the totals. Every view is keyed by season, so refreshing
-- recomputes 2026-27 alongside 2025-26 without changing last season's
-- numbers (its shots don't change, so neither do its results).
--
-- A view that doesn't exist in this database is skipped rather than
-- failing the whole refresh.

create or replace function refresh_shot_views()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
  done text[] := '{}';
  zoned int;
begin
  -- Shots imported since the last run. Free throws and untracked shots
  -- (no location) stay unzoned, as in zones-and-baselines.sql.
  update shot_events
  set zone = zone_of(x, y)
  where zone is null
    and x is not null and y is not null
    and coalesce(cbbd_range, '') <> 'free_throw';
  get diagnostics zoned = row_count;

  foreach v in array array[
    'zone_baselines',
    'zone_priors',
    'player_zone_stats',
    'team_zone_priors',
    'team_zone_stats',
    'team_defense_zones',
    'team_defense_zone_priors',
    'team_defense_zone_stats',
    'player_season_totals',
    'd1_season_totals',
    'site_counts'
  ] loop
    if exists (select 1 from pg_matviews where schemaname = 'public' and matviewname = v) then
      execute format('refresh materialized view %I', v);
      done := done || v;
    end if;
  end loop;
  return 'zoned ' || zoned || ' new shots; refreshed: ' || array_to_string(done, ', ');
end;
$$;

-- Only the server-side key may run it; the public can't trigger a
-- refresh (they're slow, and that would be an easy way to load the DB).
revoke execute on function refresh_shot_views() from public, anon, authenticated;
grant execute on function refresh_shot_views() to service_role;

notify pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────────
--   select refresh_shot_views();
-- Should list every view above. Takes several seconds on the free tier.
