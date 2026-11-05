-- ============================================================
-- Player box scores by game (game logs)
-- Run once in the Supabase SQL editor. Safe to rerun.
-- ============================================================
--
-- One row per player per game, from CBBD /games/players: minutes,
-- points, rebounds, assists, steals, blocks, turnovers, fouls and the
-- shooting splits. scripts/game-logs.ts loads it; the daily job adds
-- yesterday's games each morning, one API call. Team game logs are these
-- rows added up by team.
--
-- Read only by the server (secret key): RLS on, no public policies.
-- ============================================================

create table if not exists player_game_stats (
  game_id      integer  not null,
  player_id    integer  not null,
  season       smallint not null,
  team_id      integer  not null,
  opponent_id  integer,
  start_date   timestamptz,
  is_home      boolean,
  player_name  text,
  starter      boolean,
  minutes      smallint,
  points       smallint,
  oreb         smallint,
  dreb         smallint,
  rebounds     smallint,
  assists      smallint,
  steals       smallint,
  blocks       smallint,
  turnovers    smallint,
  fouls        smallint,
  fgm          smallint,
  fga          smallint,
  three_m      smallint,
  three_a      smallint,
  ftm          smallint,
  fta          smallint,
  updated_at   timestamptz not null default now(),
  primary key (game_id, player_id)
);

create index if not exists player_game_stats_player_idx on player_game_stats (season, player_id);
create index if not exists player_game_stats_team_idx on player_game_stats (season, team_id);

alter table player_game_stats enable row level security;
revoke all on player_game_stats from anon, authenticated;
grant all on player_game_stats to service_role;

notify pgrst, 'reload schema';
