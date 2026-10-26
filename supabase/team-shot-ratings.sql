-- Team shot-quality ratings, 2025-26.
--
-- WHAT THIS MEASURES: points produced per field goal attempt, built from
-- where a team shoots and how well it shoots from there, minus the same
-- figure for what it allows. A team that takes rim shots and threes and
-- concedes long twos rates well; one that settles for mid-range and gives
-- up layups rates badly.
--
-- WHAT IT LEAVES OUT, and this is not a small list: turnovers, offensive
-- rebounds, free throws, and pace. Those are a large share of what
-- separates teams. A team that shoots well and turns it over constantly
-- will look better here than it is. Treat this as a shooting rating, not
-- a power rating, and label it that way wherever it appears.
--
-- IT IS ALSO NOT PREDICTIVE. It describes the 2025-26 season. Making it
-- a 2026-27 projection requires knowing who returns, which needs roster
-- data this database does not have.

create materialized view if not exists team_shot_ratings as
with
-- Point value per zone, taken from the data rather than from the zone
-- names, so this survives a zone being renamed and absorbs the handful
-- of threes CBBD records as worth 2.
zone_points as (
  select zone, mode() within group (order by score_value) as pts
  from shot_events
  where zone is not null and score_value is not null
  group by zone
),

offense as (
  select
    z.season,
    z.team_id,
    sum(z.makes * p.pts)::numeric / nullif(sum(z.attempts), 0) as pps,
    sum(z.attempts)                                            as attempts
  from team_zone_stats z
  join zone_points p on p.zone = z.zone
  group by z.season, z.team_id
),

defense as (
  select
    d.season,
    d.team_id,
    sum(d.makes * p.pts)::numeric / nullif(sum(d.attempts), 0) as pps,
    sum(d.attempts)                                            as attempts
  from team_defense_zones d
  join zone_points p on p.zone = d.zone
  group by d.season, d.team_id
)

select
  o.season,
  o.team_id,
  round(o.pps, 4)                        as off_pps,
  round(d.pps, 4)                        as def_pps,
  round(o.pps - d.pps, 4)                as net_pps,
  o.attempts                             as off_attempts,
  d.attempts                             as def_attempts,
  rank() over (
    partition by o.season order by (o.pps - d.pps) desc
  )                                      as rk
from offense o
join defense d on d.season = o.season and d.team_id = o.team_id
join teams t   on t.id = o.team_id and t.is_d1 = true
-- A team with a half season of tracked games has a rating built on sand.
-- 600 attempts is roughly 12 games' worth on each side.
where o.attempts >= 600 and d.attempts >= 600;

create unique index if not exists team_shot_ratings_key
  on team_shot_ratings (season, team_id);

grant select on team_shot_ratings to service_role, anon, authenticated;
notify pgrst, 'reload schema';


-- ── Check ──────────────────────────────────────────────────────────
-- Run this and read the names, not the numbers. The top of this list
-- should be teams that were genuinely good in 2025-26. If it is full of
-- low-majors, something is wrong — most likely the defensive join, since
-- a team facing weak opponents all year gets a flattering def_pps.
--
--   select r.rk, t.school, t.conference,
--          r.off_pps, r.def_pps, r.net_pps
--   from team_shot_ratings r
--   join teams t on t.id = r.team_id
--   where r.season = 2026
--   order by r.rk
--   limit 25;
--
-- Sanity: off_pps should land around 0.90-1.05 for most teams. That is
-- points per FIELD GOAL ATTEMPT, so roughly 2 x FG% adjusted for three
-- point volume — not points per possession, which would be near 1.10.
