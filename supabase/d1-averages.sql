-- ============================================================
-- D1 season averages for the shot mix panel
-- Run after jumper-totals.sql. Safe to rerun.
-- ============================================================
--
-- One row per season: every field goal taken by a D1 team, tracked or
-- not, so a team's 2/3 split and eFG% sit beside the same measure for
-- Division I as a whole. Shots by non-D1 opponents are left out; they
-- would drag the average toward teams nobody is comparing against.
--
-- Pooled over shots rather than averaged over teams, so it matches how
-- each team's own figures are computed. The two differ by a fraction of
-- a point.
--
-- Materialized: the full-table scan is too slow to run per request.
-- refresh_season_totals() is extended to refresh it after each ingest.
-- ============================================================

drop materialized view if exists d1_season_totals;

create materialized view d1_season_totals as
select
  s.season,
  count(*)                                         as attempts,
  count(*) filter (where s.made)                   as makes,
  count(*) filter (where coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                                   as three_attempts,
  count(*) filter (where s.made and coalesce(s.zone like '%3%', s.cbbd_range = 'three_pointer'))
                                                   as three_makes
from shot_events s
join teams t on t.id = s.team_id
where (s.zone is not null or s.x is null)  -- field goals, tracked or not
  and t.is_d1
group by s.season;

create unique index if not exists d1_season_totals_key on d1_season_totals (season);


create or replace function refresh_season_totals()
returns void
language sql
security definer
set search_path = public
as $$
  refresh materialized view concurrently player_season_totals;
  refresh materialized view concurrently d1_season_totals;
$$;

revoke execute on function refresh_season_totals() from public, anon, authenticated;
grant execute on function refresh_season_totals() to service_role;

grant select on d1_season_totals to service_role, anon, authenticated;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- Check
-- ------------------------------------------------------------
-- Expect roughly 60% twos, 40% threes, eFG% in the low 50s.
select season,
       round(100.0 * (attempts - three_attempts) / attempts, 1) as two_share,
       round(100.0 * three_attempts / attempts, 1)             as three_share,
       round(100.0 * (makes + 0.5 * three_makes) / attempts, 1) as efg
from d1_season_totals
order by season;
