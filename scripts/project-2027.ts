/**
 * Our own 2026-27 preseason ranking. Uses no outside rankings: only this
 * project's 2025-26 shot data and ratings, plus 2026-27 rosters from CBBD.
 *
 *   npx tsx --env-file=.env.local scripts/project-2027.ts
 *   npx tsx --env-file=.env.local scripts/project-2027.ts --rosters path/to/roster.json
 *
 * One CBBD call (/teams/roster?season=2027 returns every team), skipped
 * with --rosters when you already have the payload. Writes:
 *   - player_seasons rows for 2027 (who is on which team)
 *   - lib/formula-2027.json, which the rankings page reads
 *
 * Re-run whenever rosters change. The method is explained on the page
 * (app/rankings/Formula.tsx); keep the two in step.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEASON_FROM = 2026;
const SEASON_TO = 2027;

// ── Tuning. Each one is described in the page's methodology. ─────────

/** Attempts of league-average shooting blended into each player's rate. */
const SHRINK_ATTEMPTS = 150;
/** Share of a program's old offensive edge credited to minutes we can't
 *  attribute to a known player (freshmen, internationals, non-D1). */
const PROGRAM_CARRYOVER = 0.5;
/** Defense keeps this much of last season's edge with nobody back... */
const DEF_BASE = 0.35;
/** ...plus this much more in proportion to returning shot volume. */
const DEF_CONTINUITY = 0.45;
/** Ranked teams plus honorable mentions. */
const RANKED = 25;
const HONORABLE = 10;

/**
 * CBBD's 2027 rosters drop departed players but, for most teams, don't
 * yet list newcomers. These incoming transfers come from ESPN's AP
 * preseason poll breakdown (Oct 19, 2026), which lists each ranked
 * team's transfers and their old schools. Roster facts only; no rankings
 * are taken from it. Matched to 2025-26 stats by name and old school.
 *   https://www.espn.com/mens-college-basketball/story/_/id/50191393
 */
const ROSTER_ADDITIONS: Record<string, [player: string, from: string][]> = {
  Florida: [["Denzel Aberdeen", "Kentucky"]],
  Duke: [["John Blackwell", "Wisconsin"], ["Drew Scharnowski", "Belmont"]],
  UConn: [["Nik Khamenia", "Duke"], ["Na'jai Hines", "Seton Hall"]],
  Illinois: [["Stefan Vaaks", "Providence"]],
  Arizona: [["Derek Dixon", "North Carolina"], ["RJ Godfrey", "Clemson"]],
  "Michigan State": [["Anton Bonke", "Charlotte"]],
  Texas: [["Isaiah Johnson", "Colorado"], ["Elyjah Freeman", "Auburn"], ["David Punch", "TCU"]],
  Tennessee: [
    ["Terrence Hill Jr.", "VCU"], ["Tyler Lundblade", "Belmont"], ["Juke Harris", "Wake Forest"],
    ["Jalen Haralson", "Notre Dame"], ["Miles Rubin", "Loyola Chicago"],
  ],
  Virginia: [["Jurian Dixon", "UC Irvine"]],
  Houston: [["Dedan Thomas Jr.", "LSU"], ["Delrecco Gillespie", "Kent State"]],
  Louisville: [
    ["Seth Trimble", "North Carolina"], ["Karter Knox", "Arkansas"],
    ["Alvaro Folgueiras", "Iowa"], ["Flory Bidunga", "Kansas"],
  ],
  Arkansas: [["Jeremiah Wilkinson", "Georgia"], ["Cooper Bowser", "Furman"]],
  "St. John's": [["Tounde Yessoufou", "Baylor"], ["Keyshawn Hall", "Auburn"]],
  Miami: [["Acaden Lewis", "Villanova"], ["Somto Cyril", "Georgia"]],
  Gonzaga: [["Xaivian Lee", "Florida"], ["Chauncey Wiggins", "Florida State"], ["Massamba Diop", "Arizona State"]],
  Michigan: [["J.P. Estrella", "Tennessee"], ["Moustapha Thiam", "Cincinnati"]],
  Kansas: [["Leroy Blyden Jr.", "Toledo"], ["Keanu Dawes", "Utah"]],
  "Iowa State": [["Tre Singleton", "Northwestern"]],
  "Texas Tech": [["Cruz Davis", "Hofstra"], ["Darrion Williams", "NC State"], ["Jamichael Stillwell", "UCF"]],
  Alabama: [["Drew Fielder", "Boise State"], ["Brandon Garrison", "Kentucky"]],
  USC: [["KJ Lewis", "Georgetown"], ["Eric Reibe", "UConn"]],
  UCLA: [["Jaylen Petty", "Texas Tech"]],
  Kentucky: [["Milan Momcilovic", "Iowa State"], ["Zoom Diallo", "Washington"], ["Alex Wilkins", "Furman"]],
  Vanderbilt: [["Berke Buyuktuncel", "Nebraska"], ["Bangot Dak", "Colorado"], ["Ace Glass", "Washington State"]],
  BYU: [["Collin Chandler", "Kentucky"], ["Jake Wahlin", "Clemson"], ["Jaxon Kohler", "Michigan State"]],
};

/** Confirmed out for 2026-27; their shots don't count for anyone. */
const OUT_FOR_SEASON: [player: string, team: string][] = [
  ["Solo Ball", "UConn"], // wrist surgery, medical redshirt (UConn, Apr 20)
  ["Donnie Freeman", "Syracuse"], // Achilles, St. John's transfer (Jul 2)
];

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

type RosterTeam = {
  teamId: number;
  team: string;
  players: { id: number; name: string; startSeason: number | null }[];
};

type PlayerTotals = {
  player_id: number;
  player_name: string;
  team_id: number;
  attempts: number;
  makes: number;
  three_makes: number;
};

type TeamRating = {
  team_id: number;
  adj_off: number;
  adj_def: number;
  raw_off: number;
};

async function main() {
  const rosterArg = process.argv.indexOf("--rosters");
  const rosters: RosterTeam[] =
    rosterArg > -1
      ? JSON.parse(readFileSync(process.argv[rosterArg + 1], "utf8"))
      : await fetchRosters();

  const [teams, ratings, totals, league] = await Promise.all([
    selectAll<{ id: number; school: string; conference: string | null }>(
      "teams", "id, school, conference", "id", { is_d1: true },
    ),
    selectAll<TeamRating>(
      "team_adjusted_ratings", "team_id, adj_off, adj_def, raw_off", "team_id",
      { season: SEASON_FROM },
    ),
    selectAll<PlayerTotals>(
      "player_season_totals",
      "player_id, player_name, team_id, attempts, makes, three_makes",
      "player_id",
      { season: SEASON_FROM },
      { attempts: 0 },
    ),
    db.from("d1_season_totals").select("attempts, makes, three_makes")
      .eq("season", SEASON_FROM).single(),
  ]);
  if (league.error) throw new Error(league.error.message);

  const lg = pps(league.data);
  const d1 = new Map(teams.map((t) => [t.id, t]));
  const rating = new Map(ratings.map((r) => [r.team_id, r]));
  const lastSeason = new Map(totals.map((p) => [p.player_id, p]));

  // Each team's total 2025-26 shot volume: the size of the hole to fill.
  const teamVolume = new Map<number, number>();
  for (const p of totals) {
    teamVolume.set(p.team_id, (teamVolume.get(p.team_id) ?? 0) + p.attempts);
  }

  const d1Rosters = rosters.filter((t) => d1.has(t.teamId) && t.players.length);
  await saveRosters(d1Rosters);

  // Resolve hand-listed names to player ids through last season's stats.
  const schoolId = new Map(teams.map((t) => [t.school, t.id]));
  const findPlayer = (name: string, school: string) =>
    totals.find((p) => p.player_name === name && p.team_id === schoolId.get(school));

  const sidelined = new Set<number>();
  for (const [name, school] of OUT_FOR_SEASON) {
    const p = findPlayer(name, school);
    if (p) sidelined.add(p.player_id);
    else console.warn(`  out-for-season not matched: ${name} (${school})`);
  }

  const added = new Map<number, number[]>();
  for (const [school, list] of Object.entries(ROSTER_ADDITIONS)) {
    const id = schoolId.get(school);
    if (!id) {
      console.warn(`  unknown school in additions: ${school}`);
      continue;
    }
    for (const [name, from] of list) {
      const p = findPlayer(name, from);
      if (p) added.set(id, [...(added.get(id) ?? []), p.player_id]);
      else console.warn(`  addition not matched: ${name} (${from} -> ${school})`);
    }
  }

  const rows = [];
  for (const t of d1Rosters) {
    const r = rating.get(t.teamId);
    const volume = teamVolume.get(t.teamId);
    if (!r || !volume) continue;

    let returningAtt = 0;
    let shareSum = 0;
    let valueSum = 0;
    const transfersIn: { name: string; from: string; attempts: number }[] = [];

    // A roster with nobody starting in 2027 hasn't had newcomers added
    // yet. Flag it unless the hand-listed transfers fill the gap.
    const hasNewcomers = t.players.some((p) => p.startSeason === SEASON_TO);
    const ids = new Set([...t.players.map((p) => p.id), ...(added.get(t.teamId) ?? [])]);

    for (const id of ids) {
      if (sidelined.has(id)) continue;
      const p = lastSeason.get(id);
      if (!p) continue;
      const from = rating.get(p.team_id);

      // Shooting above average per shot, shrunk toward the D1 mean, and
      // credited for the defenses the player's old team faced.
      const shrunk = (pps(p) * p.attempts + lg * SHRINK_ATTEMPTS) /
        (p.attempts + SHRINK_ATTEMPTS);
      const schedule = from ? from.adj_off - from.raw_off : 0;
      const value = shrunk - lg + schedule;

      const share = p.attempts / volume;
      shareSum += share;
      valueSum += share * value;

      if (p.team_id === t.teamId) returningAtt += p.attempts;
      else {
        transfersIn.push({
          name: p.player_name,
          from: d1.get(p.team_id)?.school ?? "non-D1",
          attempts: p.attempts,
        });
      }
    }

    // A roster can hold more shot volume than one team can use. Scale the
    // known players down to a full team's worth rather than double count.
    const scale = shareSum > 1 ? 1 / shareSum : 1;
    const known = Math.min(shareSum, 1);
    const returning = Math.min(returningAtt / volume, 1);

    const off =
      lg + valueSum * scale + (1 - known) * PROGRAM_CARRYOVER * (r.adj_off - lg);
    const def = lg + (r.adj_def - lg) * (DEF_BASE + DEF_CONTINUITY * returning);

    const team = d1.get(t.teamId)!;
    rows.push({
      team_id: t.teamId,
      school: team.school,
      conference: team.conference,
      off: round(off),
      def: round(def),
      net: round(off - def),
      returning: round(returning, 3),
      known: round(known, 3),
      // Roster may be missing newcomers: the projection leans more on
      // last season's program strength than it should.
      incomplete: !hasNewcomers && !added.has(t.teamId),
      last_net: round(r.adj_off - r.adj_def),
      transfers_in: transfersIn
        .sort((a, b) => b.attempts - a.attempts)
        .slice(0, 3)
        .map(({ name, from }) => ({ name, from })),
    });
  }

  rows.sort((a, b) => b.net - a.net);
  const ranked = rows.slice(0, RANKED + HONORABLE).map((r, i) => ({ rk: i + 1, ...r }));

  const out = {
    season: SEASON_TO,
    generated_at: new Date().toISOString(),
    league_pps: round(lg),
    sources: {
      rosters: "CollegeBasketballData /teams/roster, season 2027",
      additions: "https://www.espn.com/mens-college-basketball/story/_/id/50191393/ap-mens-preseason-top-25-poll-reaction-2026-27",
    },
    params: {
      SHRINK_ATTEMPTS, PROGRAM_CARRYOVER, DEF_BASE, DEF_CONTINUITY,
      RANKED, HONORABLE,
    },
    teams_rated: rows.length,
    rows: ranked,
  };
  writeFileSync("lib/formula-2027.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`Rated ${rows.length} teams. Top 5:`);
  for (const r of ranked.slice(0, 5)) console.log(`  ${r.rk}. ${r.school} ${r.net}`);
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Points per field goal attempt: 2 per make, plus 1 more per three. */
function pps(t: { attempts: number; makes: number; three_makes: number }) {
  return (2 * t.makes + t.three_makes) / t.attempts;
}

function round(n: number, places = 4) {
  return Number(n.toFixed(places));
}

async function fetchRosters(): Promise<RosterTeam[]> {
  const started = Date.now();
  const res = await fetch(
    `https://api.collegebasketballdata.com/teams/roster?season=${SEASON_TO}`,
    { headers: { Authorization: `Bearer ${env("CBBD_API_KEY")}` } },
  );
  await db.from("api_calls").insert({
    endpoint: "/teams/roster",
    params: { season: String(SEASON_TO) },
    status: res.status,
    ms: Date.now() - started,
  });
  if (!res.ok) throw new Error(`CBBD ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Who is where in 2026-27. Players need a row first (foreign key). */
async function saveRosters(rosters: RosterTeam[]) {
  const players = rosters.flatMap((t) => t.players.map((p) => ({ id: p.id, name: p.name })));
  const seasons = rosters.flatMap((t) =>
    t.players.map((p) => ({ player_id: p.id, season: SEASON_TO, team_id: t.teamId })),
  );
  await upsertAll("players", players, "id");
  await upsertAll("player_seasons", seasons, "player_id,season");
}

async function upsertAll(table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
  }
}

/** PostgREST caps a read at 1,000 rows, so page through. */
async function selectAll<T>(
  table: string,
  columns: string,
  orderBy: string,
  eq: Record<string, string | number | boolean>,
  gt: Record<string, number> = {},
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(columns);
    for (const [col, v] of Object.entries(eq)) q = q.eq(col, v);
    for (const [col, v] of Object.entries(gt)) q = q.gt(col, v);
    const { data, error } = await q.order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
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
