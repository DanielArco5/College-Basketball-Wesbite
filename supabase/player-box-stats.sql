-- ============================================================
-- Player box-score stats by season
-- Run once in the Supabase SQL editor. Safe to rerun.
-- ============================================================
--
-- Season totals per player per team, from CBBD /stats/player/season:
-- points, rebounds, assists, steals, blocks, turnovers, fouls and the
-- official shooting splits. scripts/player-stats.ts loads it; the daily
-- job reloads the live season each morning. A player who changed teams
-- mid-season has a row per team.
--
-- Read only by the server (secret key): RLS on, no public policies.
-- ============================================================

create table if not exists player_box_seasons (
  season       smallint not null,
  player_id    integer  not null,
  team_id      integer  not null,
  games        smallint,
  starts       smallint,
  minutes      integer,
  points       integer,
  oreb         integer,
  dreb         integer,
  rebounds     integer,
  assists      integer,
  steals       integer,
  blocks       integer,
  turnovers    integer,
  fouls        integer,
  fgm          integer,
  fga          integer,
  two_m        integer,
  two_a        integer,
  three_m      integer,
  three_a      integer,
  ftm          integer,
  fta          integer,
  updated_at   timestamptz not null default now(),
  primary key (season, player_id, team_id)
);

create index if not exists player_box_seasons_team_idx on player_box_seasons (season, team_id);

alter table player_box_seasons enable row level security;
revoke all on player_box_seasons from anon, authenticated;
grant all on player_box_seasons to service_role;

notify pgrst, 'reload schema';
