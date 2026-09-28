-- ============================================================
-- Team-level zone stats
-- Run after zones-and-baselines.sql. Safe to run top to bottom.
-- ============================================================
--
-- Same machinery as the player views, with one deliberate difference:
-- the prior is fitted separately.
--
-- A team's zone rate is an average over hundreds or thousands of shots,
-- so it carries far less noise than a player's. That means the observed
-- spread between teams is mostly real skill rather than sampling error,
-- and the method-of-moments fit produces a different k. Reusing the
-- player prior here would apply the wrong correction — invisibly, which
-- is the dangerous kind of wrong.
-- ============================================================


create materialized view team_zone_priors as
with team_zone as (
  select s.season, s.zone, s.team_id,
         count(*)                                   as attempts,
         avg(case when s.made then 1.0 else 0.0 end) as rate
  from shot_events s
  join teams t on t.id = s.team_id
  where s.zone is not null
    and t.is_d1
  group by s.season, s.zone, s.team_id
  having count(*) >= 25
)
select
  season,
  zone,
  avg(rate)      as prior_mean,
  var_samp(rate) as prior_var,
  greatest(
    avg(rate) * (1 - avg(rate)) / nullif(var_samp(rate), 0) - 1,
    1
  )              as k
from team_zone
group by season, zone;

create unique index team_zone_priors_key on team_zone_priors (season, zone);


create materialized view team_zone_stats as
with raw as (
  select s.season, s.team_id, s.zone,
         count(*)                                as attempts,
         sum(case when s.made then 1 else 0 end) as makes
  from shot_events s
  join teams t on t.id = s.team_id
  where s.zone is not null
    and t.is_d1
  group by s.season, s.team_id, s.zone
)
select
  r.season, r.team_id, r.zone, r.attempts, r.makes,
  r.makes::numeric / r.attempts                       as raw_fg_pct,
  (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) as fg_pct,
  b.fg_pct                                            as league_fg_pct,
  (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct as fg_pct_vs_league,

  -- Share of the team's total attempts taken from this zone. This is the
  -- shot-profile story: whether a team lives at the rim or hunts threes.
  r.attempts::numeric / sum(r.attempts) over (partition by r.season, r.team_id)
                                                      as attempt_share,

  case
    when r.attempts < 25 then 'gray'
    else case
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct >=  0.03 then 'hot'
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct >=  0.01 then 'warm'
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct <= -0.03 then 'cold'
      when (r.makes + p.k * p.prior_mean) / (r.attempts + p.k) - b.fg_pct <= -0.01 then 'cool'
      else 'neutral'
    end
  end as color_bucket
from raw r
join team_zone_priors p on p.season = r.season and p.zone = r.zone
join zone_baselines   b on b.season = r.season and b.zone = r.zone;

create unique index team_zone_stats_key on team_zone_stats (season, team_id, zone);

-- Note the tighter color thresholds above: ±1 and ±3 points rather than
-- the ±2 and ±6 used for players. Teams cluster much closer to the league
-- mean, so the player thresholds would render every team neutral and the
-- chart would carry no information.


-- ------------------------------------------------------------
-- Grants. Materialized views are not covered by the default grants
-- Supabase applies to new tables, so PostgREST cannot see them until
-- this runs. Symptom is an empty page with no error.
-- ------------------------------------------------------------
grant select on
  zone_baselines,
  zone_priors,
  player_zone_stats,
  team_zone_priors,
  team_zone_stats
to service_role, anon, authenticated;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- Check
-- ------------------------------------------------------------
select zone,
       round(prior_mean, 3) as league_rate,
       round(k, 0)          as team_k,
       (select round(k, 0) from zone_priors z
         where z.season = t.season and z.zone = t.zone) as player_k
from team_zone_priors t
order by zone;

-- team_k should come out much larger than player_k in most zones. That
-- is the fit noticing teams are more alike than players are.
