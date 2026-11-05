/**
 * Final scores of every 2026-27 Division I game, from ESPN's public
 * scoreboard (the JSON the ticker reads). No API calls against CBBD.
 *
 *   npx tsx --env-file=.env.local scripts/game-results.ts
 *
 * Writes scripts/.cache/results-2027.json: one row per finished game,
 * teams keyed by our teams.id (null for a school we don't carry, such as
 * a non-D1 opponent). Only games ESPN marks final are kept, so a game in
 * progress never moves the ranking. scripts/project-2027.ts rates teams
 * on these results.
 *
 * Past days are cached under scripts/.cache/espn/<date>.json once every
 * game on them is over, so a run re-reads only today and yesterday.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEASON = 2027;
/** Notre Dame at Villanova tipped a day before the rest, on November 1. */
const SEASON_START = "2026-11-01";
const SEASON_END = "2027-04-12";
const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const DIR = "scripts/.cache/espn";

type EspnEvent = {
  id: string;
  date: string;
  competitions?: {
    neutralSite?: boolean;
    conferenceCompetition?: boolean;
    type?: { abbreviation?: string };
    status?: { type?: { name?: string; state?: string; completed?: boolean } };
    competitors?: { homeAway: string; score?: string; team?: { id?: string; location?: string } }[];
  }[];
};

export type Result = {
  espn_id: string;
  date: string;
  neutral: boolean;
  /** A regular-season conference game; conference tournaments don't count. */
  conference: boolean;
  home: number | null;
  away: number | null;
  home_name: string;
  away_name: string;
  home_pts: number;
  away_pts: number;
};

/** A game not played yet, for each team's "next game". */
export type Upcoming = {
  espn_id: string;
  date: string;
  neutral: boolean;
  home: number | null;
  away: number | null;
  home_name: string;
  away_name: string;
};

/** Days of schedule read ahead for the next game. */
const LOOKAHEAD_DAYS = 8;

async function main() {
  const db = connect();
  const { data: teams, error } = await db.from("teams").select("id, source_id").not("source_id", "is", null);
  if (error) throw new Error(error.message);
  const byEspn = new Map((teams ?? []).map((t) => [String(t.source_id), t.id as number]));

  const today = easternDate(0);
  const last = today < SEASON_END ? today : SEASON_END;
  const results: Result[] = [];
  let pending = 0;
  for (let day = SEASON_START; day <= last; day = nextDay(day)) {
    const events = await eventsOn(day, day >= easternDate(-1));
    for (const e of events) {
      const c = e.competitions?.[0];
      const type = c?.status?.type;
      if (!type?.completed || type.name !== "STATUS_FINAL") {
        pending++;
        continue;
      }
      const home = c?.competitors?.find((t) => t.homeAway === "home");
      const away = c?.competitors?.find((t) => t.homeAway === "away");
      if (!home?.team?.id || !away?.team?.id) continue;
      results.push({
        espn_id: e.id,
        date: e.date,
        neutral: c?.neutralSite ?? false,
        conference: (c?.conferenceCompetition ?? false) && c?.type?.abbreviation === "STD",
        home: byEspn.get(home.team.id) ?? null,
        away: byEspn.get(away.team.id) ?? null,
        home_name: home.team.location ?? "",
        away_name: away.team.location ?? "",
        home_pts: Number(home.score),
        away_pts: Number(away.score),
      });
    }
  }

  // A late tip can show on two days' scoreboards; keep it once.
  const unique = [...new Map(results.map((r) => [r.espn_id, r])).values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // The week ahead, for each team's next game. Never cached: a day isn't
  // saved until every game on it is over.
  const upcoming: Upcoming[] = [];
  for (let i = 0, day = today; i < LOOKAHEAD_DAYS && day <= SEASON_END; i++, day = nextDay(day)) {
    for (const e of await eventsOn(day, true)) {
      const c = e.competitions?.[0];
      if (c?.status?.type?.state !== "pre") continue;
      const home = c.competitors?.find((t) => t.homeAway === "home");
      const away = c.competitors?.find((t) => t.homeAway === "away");
      if (!home?.team?.id || !away?.team?.id) continue;
      upcoming.push({
        espn_id: e.id,
        date: e.date,
        neutral: c.neutralSite ?? false,
        home: byEspn.get(home.team.id) ?? null,
        away: byEspn.get(away.team.id) ?? null,
        home_name: home.team.location ?? "",
        away_name: away.team.location ?? "",
      });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const path = `scripts/.cache/results-${SEASON}.json`;
  writeFileSync(
    path,
    JSON.stringify({ season: SEASON, fetched: new Date().toISOString(), source: SCOREBOARD, games: unique, upcoming }),
  );
  console.log(
    `Wrote ${unique.length} final scores and ${upcoming.length} upcoming games to ${path} ` +
      `(${pending} games in progress or not started, left out of the scores).`,
  );

  await saveScores(db, unique);
}

function connect() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/**
 * Final scores onto the games rows the shot import created (games.source_id
 * is ESPN's event id), for the per-game shot charts. Only games not yet
 * marked final are touched, so a run writes a few dozen rows at most.
 */

async function saveScores(db: ReturnType<typeof connect>, results: Result[]) {
  const byEvent = new Map(results.map((r) => [r.espn_id, r]));
  const open: { id: number; source_id: string; home_team_id: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("games")
      .select("id, source_id, home_team_id")
      .eq("season", SEASON)
      .neq("status", "final")
      .not("source_id", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`games: ${error.message}`);
    open.push(...((data ?? []) as typeof open));
    if (!data || data.length < 1000) break;
  }

  const rows = open.flatMap((g) => {
    const r = byEvent.get(g.source_id);
    if (!r) return [];
    // CBBD and ESPN agree on home and away; swap if they ever don't.
    const flip = r.away !== null && r.away === g.home_team_id;
    return [{
      id: g.id,
      season: SEASON,
      home_points: flip ? r.away_pts : r.home_pts,
      away_points: flip ? r.home_pts : r.away_pts,
      status: "final",
    }];
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("games").upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(`saving scores: ${error.message}`);
  }
  console.log(`Saved ${rows.length} final scores to games.`);
}

/**
 * One day's games. Days before yesterday are read from disk once saved;
 * a day is saved only when every game on it is over (or called off).
 */
async function eventsOn(day: string, fresh: boolean): Promise<EspnEvent[]> {
  const file = `${DIR}/${day}.json`;
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));

  const res = await fetch(`${SCOREBOARD}?dates=${day.replace(/-/g, "")}&groups=50&limit=400`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ESPN scoreboard ${day}: HTTP ${res.status}`);
  const events = ((await res.json()) as { events?: EspnEvent[] }).events ?? [];
  const settled = events.every((e) => e.competitions?.[0]?.status?.type?.completed !== false);
  if (settled) {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(events));
  }
  return events;
}

/** YYYY-MM-DD in US Eastern time, offset by `days`. */
function easternDate(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
