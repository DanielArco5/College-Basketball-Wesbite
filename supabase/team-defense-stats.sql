-- Adds league share baselines and a color bucket to the defensive view.
--
-- The offensive charts color by ACCURACY vs the D1 average, shrunk toward
-- the mean. That is the wrong headline for defense. Defenses reliably
-- control WHERE opponents shoot and much less reliably how well opponents
-- shoot once there; opponent three-point percentage is close to noise even
-- across a full season, while rim share is a repeatable skill. So the
-- defensive chart colors by SHARE OF OPPONENT ATTEMPTS.
--
-- Reading the color: red means opponents take MORE of their shots from
-- that zone than they do against an average D1 defense; blue means fewer.
-- It is descriptive, not a verdict — whether conceding mid-range jumpers
-- is good defense is a basketball question, not a data question.
--
-- Thresholds are fitted rather than guessed: one and two standard
-- deviations of the per-zone share distribution across all teams. That
-- self-calibrates per zone, which matters because teams vary a lot in rim
-- share and barely at all in corner-three share.

drop materialized view if exists team_defense_zone_stats;

create materialized view team_defense_zone_stats as
with league as (
  select
    season,
    zone,
    avg(attempt_share)    as league_share,
    stddev_pop(attempt_share) as share_sd
  from team_defense_zones
  group by season, zone
)
select
  d.season,
  d.team_id,
  d.zone,
  d.attempts,
  d.makes,
  d.attempt_share,
  (d.makes::numeric / nullif(d.attempts, 0))        as fg_pct,
  l.league_share,
  (d.attempt_share - l.league_share)                as share_vs_league,
  case
    -- A team with almost no tracked shots in a zone gets no color at all.
    -- Same principle as the offensive charts: gray says "no data," a
    -- neutral color would falsely claim "exactly average."
    when d.attempts < 25 then 'gray'
    when l.share_sd is null or l.share_sd = 0 then 'neutral'
    when d.attempt_share - l.league_share >  2 * l.share_sd then 'hot'
    when d.attempt_share - l.league_share >  1 * l.share_sd then 'warm'
    when d.attempt_share - l.league_share < -2 * l.share_sd then 'cold'
    when d.attempt_share - l.league_share < -1 * l.share_sd then 'cool'
    else 'neutral'
  end as color_bucket
from team_defense_zones d
join league l on l.season = d.season and l.zone = d.zone;

create unique index if not exists team_defense_zone_stats_key
  on team_defense_zone_stats (season, team_id, zone);

grant select on team_defense_zone_stats to service_role, anon, authenticated;
notify pgrst, 'reload schema';


-- ── Check ──────────────────────────────────────────────────────────
-- Uncomment and run on its own. Expect: buckets spread across all five
-- colors, with 'neutral' the largest group (most teams are near average
-- in most zones), and hot/cold the smallest. If nearly everything is
-- neutral the thresholds are too wide; if hot/cold dominate, too narrow.
--
-- select zone, color_bucket, count(*) as teams
-- from team_defense_zone_stats
-- where season = 2026
-- group by zone, color_bucket
-- order by zone, color_bucket;
