/**
 * Player box-score stats into player_box_seasons.
 *
 *   npm run player-stats -- --season 2026            # cached payload if there is one
 *   npm run player-stats -- --season 2027 --refresh  # always fetch (live season)
 *
 * One CBBD call per season (/stats/player/season), cached in
 * scripts/.cache/player-stats-<season>.json. A finished season never
 * changes, so it's fetched once; the daily job refreshes the live season
 * each morning. Needs supabase/player-box-stats.sql run once.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CBBD = "https://api.collegebasketballdata.com";
const CACHE = "scripts/.cache";

type Split = { made: number; attempted: number };
type PlayerSeason = {
  season: number;
  teamId: number;
  athleteId: number;
  games: number;
  starts: number;
  minutes: number;
  points: number;
  turnovers: number;
  fouls: number;
  assists: number;
  steals: number;
  blocks: number;
  fieldGoals: Split;
  twoPointFieldGoals: Split;
  threePointFieldGoals: Split;
  freeThrows: Split;
  rebounds: { offensive: number; defensive: number; total: number };
};

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function main() {
  const at = process.argv.indexOf("--season");
  const season = Number(process.argv[at + 1]);
  if (at < 0 || !season) throw new Error("Usage: npm run player-stats -- --season 2026 [--refresh]");
  const refresh = process.argv.includes("--refresh");

  const file = `${CACHE}/player-stats-${season}.json`;
  let rows: PlayerSeason[];
  if (!refresh && existsSync(file)) {
    rows = JSON.parse(readFileSync(file, "utf8"));
    console.log(`${season}: ${rows.length} rows from ${file} (no API call)`);
  } else {
    rows = await fetchSeason(season);
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(rows));
    console.log(`${season}: ${rows.length} rows from CBBD (1 API call)`);
  }

  // A player and team listed twice would break the upsert; keep the one
  // with more minutes.
  const best = new Map<string, PlayerSeason>();
  for (const r of rows) {
    const key = `${r.athleteId}:${r.teamId}`;
    if (!best.has(key) || (best.get(key)!.minutes ?? 0) < (r.minutes ?? 0)) best.set(key, r);
  }

  const out = [...best.values()].map((r) => ({
    season,
    player_id: r.athleteId,
    team_id: r.teamId,
    games: r.games,
    starts: r.starts,
    minutes: Math.round(r.minutes ?? 0),
    points: r.points,
    oreb: r.rebounds?.offensive ?? null,
    dreb: r.rebounds?.defensive ?? null,
    rebounds: r.rebounds?.total ?? null,
    assists: r.assists,
    steals: r.steals,
    blocks: r.blocks,
    turnovers: r.turnovers,
    fouls: r.fouls,
    fgm: r.fieldGoals?.made ?? null,
    fga: r.fieldGoals?.attempted ?? null,
    two_m: r.twoPointFieldGoals?.made ?? null,
    two_a: r.twoPointFieldGoals?.attempted ?? null,
    three_m: r.threePointFieldGoals?.made ?? null,
    three_a: r.threePointFieldGoals?.attempted ?? null,
    ftm: r.freeThrows?.made ?? null,
    fta: r.freeThrows?.attempted ?? null,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < out.length; i += 500) {
    const { error } = await db
      .from("player_box_seasons")
      .upsert(out.slice(i, i + 500), { onConflict: "season,player_id,team_id" });
    if (error) {
      throw new Error(
        `${error.message}\nIf the table is missing, run supabase/player-box-stats.sql in the Supabase SQL editor.`,
      );
    }
  }
  console.log(`Saved ${out.length} player-seasons for ${season}.`);
}

async function fetchSeason(season: number): Promise<PlayerSeason[]> {
  const params = { season: String(season) };
  const started = Date.now();
  const res = await fetch(`${CBBD}/stats/player/season?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${env("CBBD_API_KEY")}`, Accept: "application/json" },
  });
  // Same quota ledger as the other CBBD scripts.
  await db
    .from("api_calls")
    .insert({ endpoint: "/stats/player/season", params, status: res.status, ms: Date.now() - started });
  if (!res.ok) throw new Error(`CBBD ${res.status}: ${await res.text()}`);
  return (await res.json()) as PlayerSeason[];
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
