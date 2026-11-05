/**
 * Player box scores for every 2026-27 game, into player_game_stats.
 *
 *   npm run game-logs                          # since the last game saved
 *   npm run game-logs -- --from 2026-11-01     # from a date
 *
 * One CBBD call per run (/games/players over a date range: every player
 * in every game in it). The daily job runs it each morning for the games
 * since the last run, so about 30 calls a month. The newest saved day is
 * always fetched again, in case its late games weren't in yet. Needs
 * supabase/game-logs.sql run once.
 */

import { createClient } from "@supabase/supabase-js";

const SEASON = 2027;
const SEASON_START = "2026-11-01";
const CBBD = "https://api.collegebasketballdata.com";

type Split = { made: number; attempted: number };
type TeamGame = {
  gameId: number;
  season: number;
  startDate: string;
  isHome: boolean;
  teamId: number;
  opponentId: number | null;
  players: {
    athleteId: number;
    name: string;
    starter: boolean;
    minutes: number | null;
    points: number | null;
    turnovers: number | null;
    fouls: number | null;
    assists: number | null;
    steals: number | null;
    blocks: number | null;
    fieldGoals?: Split;
    threePointFieldGoals?: Split;
    freeThrows?: Split;
    rebounds?: { offensive: number; defensive: number; total: number };
  }[];
};

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function main() {
  const at = process.argv.indexOf("--from");
  const from = at > -1 ? process.argv[at + 1] : await resumeFrom();
  const to = new Date().toISOString();

  const params = {
    season: String(SEASON),
    startDateRange: `${from}T00:00:00Z`,
    endDateRange: to,
  };
  const started = Date.now();
  const res = await fetch(`${CBBD}/games/players?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${env("CBBD_API_KEY")}`, Accept: "application/json" },
  });
  // Same quota ledger as the other CBBD scripts.
  await db
    .from("api_calls")
    .insert({ endpoint: "/games/players", params, status: res.status, ms: Date.now() - started });
  if (!res.ok) throw new Error(`CBBD ${res.status}: ${await res.text()}`);
  const teamGames = (await res.json()) as TeamGame[];

  const rows = teamGames.flatMap((g) =>
    g.players
      // A player who never checked in has no line worth keeping.
      .filter((p) => (p.minutes ?? 0) > 0 || (p.points ?? 0) > 0)
      .map((p) => ({
        game_id: g.gameId,
        player_id: p.athleteId,
        season: g.season,
        team_id: g.teamId,
        opponent_id: g.opponentId,
        start_date: g.startDate,
        is_home: g.isHome,
        player_name: p.name,
        starter: p.starter,
        minutes: Math.round(p.minutes ?? 0),
        points: p.points,
        oreb: p.rebounds?.offensive ?? null,
        dreb: p.rebounds?.defensive ?? null,
        rebounds: p.rebounds?.total ?? null,
        assists: p.assists,
        steals: p.steals,
        blocks: p.blocks,
        turnovers: p.turnovers,
        fouls: p.fouls,
        fgm: p.fieldGoals?.made ?? null,
        fga: p.fieldGoals?.attempted ?? null,
        three_m: p.threePointFieldGoals?.made ?? null,
        three_a: p.threePointFieldGoals?.attempted ?? null,
        ftm: p.freeThrows?.made ?? null,
        fta: p.freeThrows?.attempted ?? null,
        updated_at: new Date().toISOString(),
      })),
  );

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from("player_game_stats")
      .upsert(rows.slice(i, i + 500), { onConflict: "game_id,player_id" });
    if (error) {
      throw new Error(
        `${error.message}\nIf the table is missing, run supabase/game-logs.sql in the Supabase SQL editor.`,
      );
    }
  }
  const games = new Set(teamGames.map((g) => g.gameId)).size;
  console.log(`${from} to now: ${rows.length} player lines across ${games} games (1 API call).`);
}

/** The newest day already saved (fetched again), or the season's start. */
async function resumeFrom() {
  const { data, error } = await db
    .from("player_game_stats")
    .select("start_date")
    .eq("season", SEASON)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `${error.message}\nIf the table is missing, run supabase/game-logs.sql in the Supabase SQL editor.`,
    );
  }
  if (!data?.start_date) return SEASON_START;
  return new Date(data.start_date).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
