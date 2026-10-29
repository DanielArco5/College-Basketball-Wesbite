-- ============================================================
-- Merge the three mid-range zones into one
-- Run once in the Supabase SQL editor, top to bottom. Safe to rerun.
-- ============================================================
--
-- mid_left, mid_center and mid_right become a single mid_range: every
-- two outside the restricted area and the paint. Three thin slices
-- made the chart choppy and split an already rare shot three ways, so
-- each slice was often too small to color.
--
-- Baselines, priors and color buckets are all GROUP BY zone, so
-- refreshing the views gives mid_range its own D1 average, shrinkage
-- and color with no other changes. lib/court.ts zoneOf() already
-- matches this function.
--
-- Also fixes a gap: the daily import writes new shots with zone left
-- empty, and nothing filled it in, so 2026-27 shots would never have
-- shown on a chart. refresh_shot_views() now zones them first.
-- ============================================================


-- 1. New zone function. Both signatures are dropped first: earlier
-- files disagree on numeric vs double precision, and replacing one
-- while the other survives would leave the old zones in use.
drop function if exists zone_of(numeric, numeric);
drop function if exists zone_of(double precision, double precision);

create function zone_of(x numeric, y numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when x <= 9.9 and y >= 46.66 then 'corner_3_left'
    when x <= 9.9 and y <=  3.34 then 'corner_3_right'

    when sqrt(power(x - 5.25, 2) + power(y - 25, 2)) >= 22.1458
         and (y - 25) > tan(radians(26)) * (x - 5.25)
      then 'wing_3_left'
    when sqrt(power(x - 5.25, 2) + power(y - 25, 2)) >= 22.1458
         and (25 - y) > tan(radians(26)) * (x - 5.25)
      then 'wing_3_right'
    when sqrt(power(x - 5.25, 2) + power(y - 25, 2)) >= 22.1458
      then 'top_3'

    when sqrt(power(x - 5.25, 2) + power(y - 25, 2)) <= 4
      then 'restricted_area'

    when x <= 19 and y between 19 and 31
      then 'paint_non_ra'

    else 'mid_range'
  end;
$$;


-- 2. Re-tag the old mid-range rows. Nothing else moves.
update shot_events
set zone = 'mid_range'
where zone in ('mid_left', 'mid_center', 'mid_right');


-- 3. Refresh now zones any new shots before rebuilding the views.
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


-- 4. Rebuild everything computed per zone.
select refresh_shot_views();


-- 5. Check. Expect one mid_range row per season, none of the old three,
-- and every mid_range shot a two.
select season, zone, count(*) as shots,
       min(score_value) as min_pts, max(score_value) as max_pts
from shot_events
where zone in ('mid_range', 'mid_left', 'mid_center', 'mid_right')
group by season, zone
order by season, zone;
