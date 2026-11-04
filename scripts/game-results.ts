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
    status?: { type?: { name?: string; completed?: boolean } };
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

async function main() {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
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
  const path = `scripts/.cache/results-${SEASON}.json`;
  writeFileSync(path, JSON.stringify({ season: SEASON, fetched: new Date().toISOString(), source: SCOREBOARD, games: unique }));
  console.log(`Wrote ${unique.length} final scores to ${path} (${pending} games not final yet, left out).`);
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
