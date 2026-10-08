-- ============================================================
-- Untracked shots
-- Run once, BEFORE `npm run ingest -- --untracked`. Safe to rerun.
-- ============================================================
--
-- Some games have no shot-location tracking, and some tracked games miss
-- a handful of shots. The original ingest dropped every field goal
-- without coordinates, so those games vanished entirely — a team could
-- show 21 games for a 31-game season.
--
-- Those shots are now kept with x, y, dist_ft and zone all null. CBBD
-- still labels them rim / jumper / three_pointer, so they count toward
-- season totals, FG% and the 2/3 split, but never toward a zone: there
-- is no location to put them in. Every zone view already filters on
-- `zone is not null`, so the charts and their baselines are unchanged.
--
-- A field goal is therefore: zone is not null (located) or x is null
-- (untracked — only field goals are stored without a location).
-- ============================================================

alter table shot_events alter column x       drop not null;
alter table shot_events alter column y       drop not null;
alter table shot_events alter column dist_ft drop not null;

-- Defensive totals filter on opponent_id; without this every request
-- scans the whole table.
create index if not exists shot_opponent_idx on shot_events (season, opponent_id);


-- ------------------------------------------------------------
-- Season totals, all field goals, tracked or not
-- ------------------------------------------------------------
-- Plain views rather than materialized: they are always read for one
-- team, which the (season, team_id) and (season, opponent_id) indexes
-- make cheap, and there is nothing to refresh after an ingest.

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
  count(distinct s.game_id)                        as games
from shot_events s
where s.zone is not null or s.x is null
group by s.season, s.team_id;

-- The same totals for the shots a team allowed.
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
  count(distinct s.game_id)                        as games
from shot_events s
where s.zone is not null or s.x is null
group by s.season, s.opponent_id;


-- ------------------------------------------------------------
-- Player season totals, rebuilt to count untracked shots
-- ------------------------------------------------------------
-- Stays materialized: the picker reads every player at once. Refreshed
-- by refresh_season_totals() below at the end of each ingest.

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
    count(*) filter (where s.x is null) as untracked_attempts
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
  sum(t.untracked_attempts)::int  as untracked_attempts
from per_team t
join primary_team pt
  on pt.season = t.season and pt.player_id = t.player_id
join players p
  on p.id = t.player_id
group by t.season, t.player_id, p.name, pt.team_id;

create unique index if not exists player_season_totals_key
  on player_season_totals (season, player_id);


-- Lets the ingest script refresh the totals itself, so a backfill does
-- not end with a trip to the SQL editor. Service role only.
create or replace function refresh_season_totals()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently player_season_totals;
$$;

revoke execute on function refresh_season_totals() from public, anon, authenticated;
grant execute on function refresh_season_totals() to service_role;


grant select on team_season_totals, team_defense_season_totals, player_season_totals
  to service_role, anon, authenticated;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- Check — run on its own after the ingest
-- ------------------------------------------------------------
-- Expect untracked shots to be a few percent of the season, concentrated
-- in the teams whose game counts were short.
--
-- select t.school, s.games, s.attempts, s.untracked_attempts
-- from team_season_totals s join teams t on t.id = s.team_id
-- where s.season = 2026 and t.is_d1
-- order by s.untracked_attempts desc
-- limit 20;
