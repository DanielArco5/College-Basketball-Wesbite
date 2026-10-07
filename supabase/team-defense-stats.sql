-- ============================================================
-- Team defensive zone stats
-- Run after team-zones.sql. Safe to run top to bottom.
-- ============================================================
--
-- The mirror of team_zone_stats: the same accuracy-vs-D1 coloring, the
-- same shrinkage and the same ±1 / ±3 point thresholds, applied to the
-- shots a team ALLOWS. Red means opponents shoot better than the D1
-- average from that zone, blue means worse — the same reading as the
-- offensive chart, so the two can be compared side by side.
--
-- The prior is fitted separately from the offensive one. Opponent FG% is
-- noisier than a team's own — defenses control where opponents shoot far
-- more reliably than how well they shoot once there — so the fit should
-- come out with a larger k and pull harder toward the league mean. That
-- is the honest result: most defenses will read close to neutral.
--
-- The league baseline is shared with offense. Every shot is one team's
-- attempt and another's attempt allowed, so the D1 average is the same.
-- ============================================================

drop materialized view if exists team_defense_zone_stats;
drop materialized view if exists team_defense_zone_priors;

create materialized view team_defense_zone_priors as
with team_zone as (
  select season, zone, team_id,
         makes::numeric / attempts as rate
  from team_defense_zones
  where attempts >= 25
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

create unique index team_defense_zone_priors_key
  on team_defense_zone_priors (season, zone);


create materialized view team_defense_zone_stats as
select
  d.season, d.team_id, d.zone, d.attempts, d.makes,
  d.makes::numeric / nullif(d.attempts, 0)            as raw_fg_pct,
  (d.makes + p.k * p.prior_mean) / (d.attempts + p.k) as fg_pct,
  b.fg_pct                                            as league_fg_pct,
  (d.makes + p.k * p.prior_mean) / (d.attempts + p.k) - b.fg_pct as fg_pct_vs_league,

  -- Share of opponent attempts from this zone: where teams shoot against
  -- this defense.
  d.attempt_share,

  case
    when d.attempts < 25 then 'gray'
    else case
      when (d.makes + p.k * p.prior_mean) / (d.attempts + p.k) - b.fg_pct >=  0.03 then 'hot'
      when (d.makes + p.k * p.prior_mean) / (d.attempts + p.k) - b.fg_pct >=  0.01 then 'warm'
      when (d.makes + p.k * p.prior_mean) / (d.attempts + p.k) - b.fg_pct <= -0.03 then 'cold'
      when (d.makes + p.k * p.prior_mean) / (d.attempts + p.k) - b.fg_pct <= -0.01 then 'cool'
      else 'neutral'
    end
  end as color_bucket
from team_defense_zones d
join team_defense_zone_priors p on p.season = d.season and p.zone = d.zone
join zone_baselines           b on b.season = d.season and b.zone = d.zone;

create unique index team_defense_zone_stats_key
  on team_defense_zone_stats (season, team_id, zone);

grant select on team_defense_zone_priors, team_defense_zone_stats
  to service_role, anon, authenticated;
notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- Check
-- ------------------------------------------------------------
-- defense_k should come out larger than offense_k in most zones: the fit
-- noticing that opponent shooting varies less between defenses than a
-- team's own shooting varies between offenses.
select zone,
       round(prior_mean, 3) as league_rate,
       round(k, 0)          as defense_k,
       (select round(k, 0) from team_zone_priors o
         where o.season = d.season and o.zone = d.zone) as offense_k
from team_defense_zone_priors d
where season = 2026
order by zone;
