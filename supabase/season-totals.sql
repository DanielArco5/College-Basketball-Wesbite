-- Season-level shot totals per player, for the shot chart picker.
-- Built from shot_events rather than player_zone_stats so the totals
-- don't inherit any per-zone filtering.
create materialized view if not exists player_season_totals as
with per_team as (
  select
    s.season,
    s.player_id,
    s.team_id,
    count(*)                        as attempts,
    count(*) filter (where s.made)  as makes
  from shot_events s
  where s.player_id is not null
    and s.zone is not null          -- field goals only; drops free throws
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
  p.name        as player_name,
  pt.team_id,
  sum(t.attempts)::int as attempts,
  sum(t.makes)::int    as makes
from per_team t
join primary_team pt
  on pt.season = t.season and pt.player_id = t.player_id
join players p
  on p.id = t.player_id
group by t.season, t.player_id, p.name, pt.team_id;

create unique index if not exists player_season_totals_key
  on player_season_totals (season, player_id);

grant select on player_season_totals to service_role, anon, authenticated;
notify pgrst, 'reload schema';
