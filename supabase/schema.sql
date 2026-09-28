-- ============================================================
-- Shot chart core schema (Supabase / Postgres)
-- Run in the Supabase SQL editor.
-- ============================================================

-- ------------------------------------------------------------
-- TEAMS
-- Colors come straight off the CBBD /teams endpoint. Do not
-- hand-map 360+ hex codes. Use color_override only for the
-- handful whose primary is unreadable on a dark background.
-- ------------------------------------------------------------
create table if not exists teams (
  id              integer primary key,        -- CBBD team id
  source_id       text unique,                -- ESPN id
  school          text not null,
  mascot          text,
  abbreviation    text,
  short_display   text,
  conference      text,
  primary_color   text,                       -- hex, e.g. '#0021A5'
  alt_color       text,
  color_override  text,                       -- you set this by hand when needed
  logo_url        text,
  is_d1           boolean default true,
  updated_at      timestamptz default now()
);

-- Effective color for the UI. Frontend reads this, never the raw column.
create or replace view team_colors as
select
  id,
  school,
  coalesce(color_override, primary_color, '#4B5563') as color,
  coalesce(alt_color, '#111827')                     as color_alt
from teams;

create index if not exists teams_conference_idx on teams (conference);

-- ------------------------------------------------------------
-- PLAYERS
-- Identity is stable across seasons; team affiliation is not
-- (transfer portal). Keep them in separate tables or you will
-- rewrite this in week 3.
-- ------------------------------------------------------------
create table if not exists players (
  id          integer primary key,            -- CBBD athlete id
  name        text not null,
  updated_at  timestamptz default now()
);

create table if not exists player_seasons (
  player_id   integer not null references players(id) on delete cascade,
  season      smallint not null,
  team_id     integer references teams(id),
  jersey      text,
  position    text,
  height_in   smallint,
  weight_lb   smallint,
  class_year  text,
  primary key (player_id, season)
);

create index if not exists player_seasons_team_idx on player_seasons (season, team_id);

-- ------------------------------------------------------------
-- GAMES
-- shots_ingested drives the cache: a final game's shots never
-- change, so once true you never refetch it.
-- ------------------------------------------------------------
create table if not exists games (
  id              integer primary key,        -- CBBD game id
  source_id       text unique,                -- ESPN id
  season          smallint not null,
  season_type     text,                       -- regular | postseason
  game_type       text,                       -- STD, NCAA, CTOURN, ...
  start_date      timestamptz,
  home_team_id    integer references teams(id),
  away_team_id    integer references teams(id),
  home_points     smallint,
  away_points     smallint,
  status          text default 'scheduled',   -- scheduled | in_progress | final
  shots_ingested  boolean default false,
  ingested_at     timestamptz
);

create index if not exists games_season_date_idx on games (season, start_date);
create index if not exists games_backfill_idx on games (season, shots_ingested) where shots_ingested = false;

-- ------------------------------------------------------------
-- SHOT EVENTS
-- Coordinate contract:
--   CBBD ships full-court coords at 10 units per foot.
--   raw_x / raw_y  = feet, full court. raw_x in [0,94], raw_y in [0,50].
--                    raw_x is the LONG axis (baseline to baseline).
--   x / y          = feet, mirrored onto the left-basket half.
--                    x in [0,47], y in [0,50]. Basket center = (5.25, 25).
-- Normalization happens once, at ingest. Never at query time.
-- ------------------------------------------------------------
create table if not exists shot_events (
  id                bigserial primary key,
  source_play_id    text unique not null,     -- CBBD play sourceId; idempotency key
  play_id           bigint,                   -- CBBD internal play id
  game_id           integer references games(id) on delete cascade,
  season            smallint not null,
  season_type       text,

  team_id           integer references teams(id),
  opponent_id       integer references teams(id),
  is_home           boolean,

  player_id         integer references players(id),
  player_name       text,                     -- denormalized; CBBD sometimes has no id

  period            smallint,
  clock             text,
  seconds_remaining integer,

  play_type         text,                     -- LayUpShot, JumpShot, DunkShot, ...
  made              boolean not null,
  score_value       smallint,                 -- 2 or 3
  assisted          boolean default false,
  assisted_by_id    integer,

  cbbd_range        text,                     -- CBBD's own bucket. Regression-test yours against it.

  raw_x             numeric(5,2),
  raw_y             numeric(5,2),
  x                 numeric(5,2) not null,
  y                 numeric(5,2) not null,
  dist_ft           numeric(5,2) not null,

  zone              text,                     -- filled by the Phase 2 bucketing job
  created_at        timestamptz default now()
);

create index if not exists shot_player_idx on shot_events (season, player_id);
create index if not exists shot_team_idx   on shot_events (season, team_id);
create index if not exists shot_game_idx   on shot_events (game_id);
create index if not exists shot_zone_idx   on shot_events (season, zone);

-- ------------------------------------------------------------
-- RAW PAYLOAD ARCHIVE
-- Your Step 3 failover. If CBBD goes down mid-season, or you
-- change the zone math, you replay from here instead of
-- re-spending API quota.
-- ------------------------------------------------------------
create table if not exists ingest_raw (
  id          bigserial primary key,
  source      text not null default 'cbbd',
  endpoint    text not null,
  params      jsonb,
  fetched_at  timestamptz default now(),
  row_count   integer,
  payload     jsonb not null
);

create index if not exists ingest_raw_lookup_idx on ingest_raw (endpoint, fetched_at desc);

-- ------------------------------------------------------------
-- API QUOTA LEDGER
-- The free CBBD tier is 1,000 calls/month. A naive per-team
-- backfill burns a third of that and double-counts every game.
-- Track every call so you know where you stand.
-- ------------------------------------------------------------
create table if not exists api_calls (
  id        bigserial primary key,
  endpoint  text not null,
  params    jsonb,
  status    integer,
  ms        integer,
  called_at timestamptz default now()
);

create or replace view api_usage_this_month as
select count(*) as calls, date_trunc('month', now()) as month
from api_calls
where called_at >= date_trunc('month', now());

-- ------------------------------------------------------------
-- INGEST CHECKPOINTS
-- Lets the backfill resume instead of restarting.
-- ------------------------------------------------------------
create table if not exists ingest_checkpoints (
  job         text primary key,
  cursor      text,
  updated_at  timestamptz default now()
);
