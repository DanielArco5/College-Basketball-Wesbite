-- ============================================================
-- Phase 2, Step 4 — zone bucketing, league baselines, shrinkage
-- Run in the Supabase SQL editor, top to bottom, once.
-- ============================================================
--
-- Coordinate contract (set at ingest, see toHalfCourt):
--   x = feet from the baseline, 0..47. Basket center at x = 5.25.
--   y = feet across the court,  0..50. Basket center at y = 25.
--   dist_ft = distance from hoop center, precomputed.
--
-- Court geometry is fixed by NCAA rule, so none of these numbers
-- are judgment calls:
--   restricted area   4 ft radius arc from hoop center
--   lane              12 ft wide (y from 19 to 31), 19 ft deep
--   three-point arc   22 ft 1.75 in  = 22.1458 ft
--   corner 3 line     3.34 ft from each sideline, running out to
--                     x = 9.9 ft where it meets the arc
-- ============================================================


-- ------------------------------------------------------------
-- 1. Zone function
-- ------------------------------------------------------------
-- Left/right are from the shooter's perspective facing the hoop.
-- Higher y = left side.

create or replace function zone_of(x numeric, y numeric)
returns text
language sql
immutable
as $$
  select case
    -- Corner threes: beyond the sideline marks, before the arc meets them.
    when x <= 9.9 and y >= 46.66 then 'corner_3_left'
    when x <= 9.9 and y <=  3.34 then 'corner_3_right'

    -- Everything else past the arc is above the break.
    when sqrt(power(x - 5.25, 2) + power(y - 25, 2)) >= 22.1458
      then 'above_break_3'

    -- Restricted area.
    when sqrt(power(x - 5.25, 2) + power(y - 25, 2)) <= 4
      then 'restricted_area'

    -- Rest of the paint.
    when x <= 19 and y between 19 and 31
      then 'paint_non_ra'

    -- Mid-range, split into thirds by angle.
    when y > 31 then 'mid_left'
    when y < 19 then 'mid_right'
    else 'mid_center'
  end;
$$;

-- Order matters above. The corner-three checks must precede the arc
-- check: a corner shot can sit closer than 22.15 ft to the hoop and
-- still be worth three, which is the whole reason the corner three is
-- the most efficient shot in basketball. Check the arc first and you
-- misclassify every one of them as mid-range.


-- ------------------------------------------------------------
-- 2. Backfill the zone column
-- ------------------------------------------------------------
-- 647k rows. Runs in well under a minute.

update shot_events
set zone = zone_of(x, y)
where zone is null;

-- Free throws have unreliable coordinates (nobody tracks a shot whose
-- location is fixed by rule) and don't belong on a shot chart at all.
update shot_events set zone = null where cbbd_range = 'free_throw';

-- Sanity check. Compare your geometry against CBBD's own labels.
-- Disagreement on a percent or two is their noise; more is your bug.
select zone,
       count(*)                          as shots,
       round(avg(dist_ft), 1)            as avg_dist,
       round(100.0 * avg(score_value) / 2, 0) as avg_pts_x100,
       mode() within group (order by cbbd_range) as cbbd_says
from shot_events
where zone is not null
group by zone
order by avg_dist;

-- Expect roughly:
--   restricted_area   ~2.5 ft   cbbd_says rim
--   paint_non_ra      ~8 ft     cbbd_says jumper
--   mid_*             ~14-17 ft cbbd_says jumper
--   corner_3_*        ~22 ft    cbbd_says three_pointer
--   above_break_3     ~25 ft    cbbd_says three_pointer
--
-- Every corner_3 and above_break_3 row should have score_value = 3.
-- Verify that directly:
select zone, score_value, count(*)
from shot_events
where zone in ('corner_3_left','corner_3_right','above_break_3')
group by zone, score_value
order by zone, score_value;
-- Any score_value = 2 rows here mean the arc math is off.


-- ------------------------------------------------------------
-- 3. League baselines
-- ------------------------------------------------------------
-- The denominator for every "relative to D1 average" claim on the
-- site. D1 shooters only — buy-game opponents would drag it down.

create materialized view zone_baselines as
select
  s.season,
  s.zone,
  count(*)                                                as attempts,
  sum(case when s.made then 1 else 0 end)                 as makes,
  avg(case when s.made then 1.0 else 0.0 end)             as fg_pct,
  avg(case when s.made then s.score_value else 0 end)     as pts_per_shot
from shot_events s
join teams t on t.id = s.team_id
where s.zone is not null
  and t.is_d1
group by s.season, s.zone;

create unique index zone_baselines_key on zone_baselines (season, zone);

-- Refresh after any new ingest:
--   refresh materialized view concurrently zone_baselines;


-- ------------------------------------------------------------
-- 4. Player-zone stats with empirical Bayes shrinkage
-- ------------------------------------------------------------
-- This is the part that stops your shot charts from being a noise
-- generator.
--
-- The problem: a player who goes 2-for-4 from the left corner has an
-- observed FG% of 50%, which renders bright red next to a league
-- average of 38%. He is not a 50% corner shooter. He is a player
-- about whom you know almost nothing.
--
-- The fix: pull every player's rate toward the league mean, by an
-- amount that depends on how many attempts back it up. Formally
--
--     shrunk = (makes + k * league_rate) / (attempts + k)
--
-- where k is the number of "phantom league-average attempts" added to
-- everyone. At attempts = k a player's rate sits halfway between his
-- own and the league's. At attempts >> k it converges on his own.
--
-- k is not a free parameter. Fit a Beta prior to the observed spread
-- of player rates within each zone by method of moments:
--
--     k = mean * (1 - mean) / variance - 1
--
-- Zones where real skill varies a lot (threes) produce a small k and
-- little shrinkage. Zones where nearly everyone converts at the same
-- rate (restricted area) produce a large k and heavy shrinkage. That
-- is the correct behavior and it falls out of the data rather than
-- being chosen.

create materialized view zone_priors as
with player_zone as (
  select s.season, s.zone, s.player_id,
         count(*)                                    as attempts,
         avg(case when s.made then 1.0 else 0.0 end)  as rate
  from shot_events s
  join teams t on t.id = s.team_id
  where s.zone is not null
    and s.player_id is not null
    and t.is_d1
  group by s.season, s.zone, s.player_id
  having count(*) >= 20   -- fit the prior on players we actually know
)
select
  season,
  zone,
  avg(rate)                                             as prior_mean,
  var_samp(rate)                                        as prior_var,
  greatest(
    avg(rate) * (1 - avg(rate)) / nullif(var_samp(rate), 0) - 1,
    1
  )                                                     as k
from player_zone
group by season, zone;

create unique index zone_priors_key on zone_priors (season, zone);


create materialized view player_zone_stats as
with raw as (
  select s.season, s.player_id, s.player_name, s.team_id, s.zone,
         count(*)                                   as attempts,
         sum(case when s.made then 1 else 0 end)    as makes
  from shot_events s
  join teams t on t.id = s.team_id
  where s.zone is not null
    and s.player_id is not null
    and t.is_d1
  group by s.season, s.player_id, s.player_name, s.team_id, s.zone
)
select
  r.season,
  r.player_id,
  r.player_name,
  r.team_id,
  r.zone,
  r.attempts,
  r.makes,
  r.makes::numeric / r.attempts                              as raw_fg_pct,
  (r.makes + p.k * p.prior_mean) / (r.attempts + p.k)        as fg_pct,
  b.fg_pct                                                   as league_fg_pct,
  (r.makes + p.k * p.prior_mean) / (r.attempts + p.k)
    - b.fg_pct                                               as fg_pct_vs_league,

  -- Color bucket. Red hot, blue cold, gray when we don't know.
  -- Thresholds are in percentage points above/below league average,
  -- applied to the SHRUNK rate — so a small sample cannot reach the
  -- outer buckets no matter how well it shot.
  case
    when r.attempts < 5 then 'gray'
    else case
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct >=  0.06 then 'hot'
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct >=  0.02 then 'warm'
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct <= -0.06 then 'cold'
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct <= -0.02 then 'cool'
      else 'neutral'
    end
  end                                                        as color_bucket
from raw r
join zone_priors    p on p.season = r.season and p.zone = r.zone
join zone_baselines b on b.season = r.season and b.zone = r.zone;

create unique index player_zone_stats_key
  on player_zone_stats (season, player_id, zone);
create index player_zone_stats_team_idx
  on player_zone_stats (season, team_id);


-- ------------------------------------------------------------
-- 5. Color scale for the frontend
-- ------------------------------------------------------------
-- Keep the hex values in one place so the shot chart, the tables and
-- the OpenGraph image generator can't drift apart.

create table if not exists color_scale (
  bucket  text primary key,
  hex     text not null,
  label   text not null,
  sort    smallint not null
);

insert into color_scale (bucket, hex, label, sort) values
  ('hot',     '#D62728', 'Well above average', 1),
  ('warm',    '#F08A5D', 'Above average',      2),
  ('neutral', '#9AA0A6', 'About average',      3),
  ('cool',    '#6BA3D6', 'Below average',      4),
  ('cold',    '#1F5FA9', 'Well below average', 5),
  ('gray',    '#3C4043', 'Not enough attempts', 6)
on conflict (bucket) do update
  set hex = excluded.hex, label = excluded.label, sort = excluded.sort;


-- ------------------------------------------------------------
-- 6. Verify the shrinkage is doing its job
-- ------------------------------------------------------------

-- What k came out per zone? Small k = little shrinkage.
select season, zone,
       round(prior_mean, 3) as league_rate,
       round(k, 1)          as k
from zone_priors
order by season, k;

-- The money query: low-volume players should NOT reach the outer
-- buckets. If any player with under ~15 attempts shows 'hot', the
-- shrinkage is too weak.
select
  case
    when attempts < 5   then '1-4'
    when attempts < 15  then '5-14'
    when attempts < 50  then '15-49'
    when attempts < 150 then '50-149'
    else '150+'
  end                                   as attempt_bucket,
  count(*)                              as players,
  round(avg(abs(raw_fg_pct - league_fg_pct)), 3) as avg_raw_gap,
  round(avg(abs(fg_pct     - league_fg_pct)), 3) as avg_shrunk_gap,
  count(*) filter (where color_bucket in ('hot','cold')) as extreme
from player_zone_stats
group by 1
order by 1;

-- avg_raw_gap should fall sharply as attempts rise — that is noise
-- disappearing. avg_shrunk_gap should stay roughly flat, because
-- shrinkage removed the noise rather than the signal. The 'extreme'
-- count should be near zero in the 5-14 bucket.
