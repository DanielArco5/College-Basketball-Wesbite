-- One row of headline counts for the home page.
--
-- Materialized, like the rest of the schema. Three distinct counts over
-- ~650k rows are not cheap enough to run on every read, and `next dev`
-- reads on every page load. The season is finished, so the only cost is
-- remembering to refresh after a re-ingest:
--   refresh materialized view site_counts;
--
-- All three numbers describe the SAME population: shots that have a
-- location. Counting every row in `games` instead would include games
-- with no shot tracking at all, and the three figures would quietly
-- describe three different datasets while sitting on one line.
--
-- Players and teams are D1 only: the home page says "every Division I
-- team and player". Shots and games still include those against non-D1
-- opponents, since those are real shots by or against D1 teams.

drop materialized view if exists site_counts;

create materialized view site_counts as
select
  s.season,
  count(*)::bigint                                          as shots,
  count(distinct s.game_id)::bigint                         as games,
  count(distinct s.player_id) filter (where t.is_d1)::bigint as players,
  count(distinct s.team_id)   filter (where t.is_d1)::bigint as teams
from shot_events s
left join teams t on t.id = s.team_id
-- Field goals with a zone: exactly what the chart draws. Free throws
-- have no location. Shots with no player_id still count as shots;
-- count(distinct) skips the nulls when counting players.
where s.zone is not null
group by s.season;

create unique index site_counts_key on site_counts (season);

grant select on site_counts to service_role, anon, authenticated;
notify pgrst, 'reload schema';


-- ── Check ──────────────────────────────────────────────────────────
--   select * from site_counts order by season desc;
--
-- Expect for 2026: shots 646,595 (zone not null; ~1,200 rows have an x
-- but no zone, and the chart can't draw them),
-- games below 6,262 (games with no tracking drop out), players a bit
-- under 4,944 (D1 players with at least one located shot), teams 365.
