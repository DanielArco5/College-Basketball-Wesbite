-- ============================================================
-- Split above_break_3 into left wing, top of the key, right wing
-- Run once in the Supabase SQL editor, top to bottom, after
-- zones-and-baselines.sql and team-zones.sql.
-- ============================================================
--
-- The single above-the-break zone covered most of the half court past
-- the arc. It now splits at 26 degrees either side of straight-on from
-- the hoop, which cuts the arc into three equal wedges. Left/right keep
-- the shooter's-eye convention: higher y = left.
--
-- Only rows currently tagged above_break_3 change. Baselines, priors
-- and color buckets are all GROUP BY zone, so refreshing the views
-- gives every new zone its own D1 average, shrinkage and color with no
-- other changes. lib/court.ts zoneOf() already matches this function.
-- ============================================================


-- 1. New zone function (same as zones-and-baselines.sql section 1)
create or replace function zone_of(x numeric, y numeric)
returns text
language sql
immutable
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

    when y > 31 then 'mid_left'
    when y < 19 then 'mid_right'
    else 'mid_center'
  end;
$$;


-- 2. Re-tag the above-the-break rows. Nothing else moves.
update shot_events
set zone = zone_of(x, y)
where zone = 'above_break_3';


-- 3. Rebuild everything computed per zone, in dependency order.
refresh materialized view zone_baselines;
refresh materialized view zone_priors;
refresh materialized view player_zone_stats;
refresh materialized view team_zone_priors;
refresh materialized view team_zone_stats;


-- 4. Check. Expect no above_break_3 left, three new zones of roughly
-- similar size (the top wedge a little smaller: fewer shots come from
-- straightaway than from the wings), and every one a three.
select zone, count(*) as shots,
       round(avg(dist_ft), 1) as avg_dist,
       min(score_value) as min_pts, max(score_value) as max_pts
from shot_events
where zone in ('above_break_3','wing_3_left','top_3','wing_3_right')
group by zone
order by zone;
