-- ============================================================
-- Refresh fixes: defense base view, and a longer time limit
-- Run once in the Supabase SQL editor, after merge-mid-range.sql.
-- Safe to rerun.
-- ============================================================
--
-- 1. team_defense_zones (the base of the Shots allowed chart) is a
--    stored view that refresh_shot_views() never refreshed, so the
--    defense charts would have stayed frozen all season.
--
-- 2. Calls through the API stop after 8 seconds by default, and a full
--    refresh takes longer, so the daily job's refresh_shot_views() call
--    timed out. The server-side key gets 10 minutes. Browser keys keep
--    their short limit.
-- ============================================================


-- 1. Longer limit for the server-side key only.
alter role service_role set statement_timeout = '10min';
notify pgrst, 'reload config';


-- 2. Refresh list now includes team_defense_zones, before the views
--    built on it.
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

revoke execute on function refresh_shot_views() from public, anon, authenticated;
grant execute on function refresh_shot_views() to service_role;

notify pgrst, 'reload schema';


-- 3. Bring the Shots allowed charts up to the merged mid-range zone.
refresh materialized view team_defense_zones;
refresh materialized view team_defense_zone_priors;
refresh materialized view team_defense_zone_stats;


-- 4. Check: expect mid_range rows and none of the old three.
select zone, count(*) from team_defense_zone_stats
where zone in ('mid_range', 'mid_left', 'mid_center', 'mid_right')
group by zone;
