-- ============================================================
-- Two-point jumpers in season totals
-- Run after untracked-shots.sql. Safe to rerun.
-- ============================================================
--
-- The chart sorts shots by WHERE they were taken, so a pull-up from 8 ft
-- in the lane counts as paint, not mid-range. Mid-range alone undercounts
-- how often a team takes jumpers inside the arc. This adds CBBD's own
-- shot-type label to the totals: a two-point jumper is any field goal
-- CBBD calls a jumper that isn't a three, tracked or not.
--
-- New columns go on the end so `create or replace view` can keep the
-- existing ones in place.
-- ============================================================

create or replace view team_season_totals as
select
  s.season,
  s.team_id,
  count(*)                                         as attempts,
  count(*) filter (where s.made)                   as makes,
  count(*) filter (where coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                                   as three_attempts,
  count(*) filter (where s.made and coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                                   as three_makes,
  count(*) filter (where s.x is null)              as untracked_attempts,
  count(distinct s.game_id)                        as games,
  count(*) filter (where s.cbbd_range = 'jumper' and coalesce(s.zone not like '%3%', true))
                                                   as jumper_attempts,
  count(*) filter (where s.made and s.cbbd_range = 'jumper' and coalesce(s.zone not like '%3%', true))
                                                   as jumper_makes
from shot_events s
where s.zone is not null or s.x is null
group by s.season, s.team_id;

create or replace view team_defense_season_totals as
select
  s.season,
  s.opponent_id                                    as team_id,
  count(*)                                         as attempts,
  count(*) filter (where s.made)                   as makes,
  count(*) filter (where coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                                   as three_attempts,
  count(*) filter (where s.made and coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                                   as three_makes,
  count(*) filter (where s.x is null)              as untracked_attempts,
  count(distinct s.game_id)                        as games,
  count(*) filter (where s.cbbd_range = 'jumper' and coalesce(s.zone not like '%3%', true))
                                                   as jumper_attempts,
  count(*) filter (where s.made and s.cbbd_range = 'jumper' and coalesce(s.zone not like '%3%', true))
                                                   as jumper_makes
from shot_events s
where s.zone is not null or s.x is null
group by s.season, s.opponent_id;


-- Materialized, so it has to be rebuilt to gain columns.
drop materialized view if exists player_season_totals;

create materialized view player_season_totals as
with per_team as (
  select
    s.season,
    s.player_id,
    s.team_id,
    count(*)                        as attempts,
    count(*) filter (where s.made)  as makes,
    count(*) filter (where coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                    as three_attempts,
    count(*) filter (where s.made and coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                    as three_makes,
    count(*) filter (where s.x is null) as untracked_attempts,
    count(*) filter (where s.cbbd_range = 'jumper' and coalesce(s.zone not like '%3%', true))
                                    as jumper_attempts,
    count(*) filter (where s.made and s.cbbd_range = 'jumper' and coalesce(s.zone not like '%3%', true))
                                    as jumper_makes
  from shot_events s
  where s.player_id is not null
    and (s.zone is not null or s.x is null)  -- field goals, tracked or not
  group by s.season, s.player_id, s.team_id
),
-- Transfers appear under two team_ids in one season. Attribute the
-- player to wherever he took the most shots rather than picking
-- arbitrarily with max().
primary_team as (
  select distinct on (season, player_id)
    season, player_id, team_id
  from per_team
  order by season, player_id, attempts desc, team_id
)
select
  t.season,
  t.player_id,
  p.name                          as player_name,
  pt.team_id,
  sum(t.attempts)::int            as attempts,
  sum(t.makes)::int               as makes,
  sum(t.three_attempts)::int      as three_attempts,
  sum(t.three_makes)::int         as three_makes,
  sum(t.untracked_attempts)::int  as untracked_attempts,
  sum(t.jumper_attempts)::int     as jumper_attempts,
  sum(t.jumper_makes)::int        as jumper_makes
from per_team t
join primary_team pt
  on pt.season = t.season and pt.player_id = t.player_id
join players p
  on p.id = t.player_id
group by t.season, t.player_id, p.name, pt.team_id;

create unique index if not exists player_season_totals_key
  on player_season_totals (season, player_id);

grant select on team_season_totals, team_defense_season_totals, player_season_totals
  to service_role, anon, authenticated;

notify pgrst, 'reload schema';
