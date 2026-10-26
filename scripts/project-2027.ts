/**
 * Our own 2026-27 preseason ranking. No outside rankings go into it.
 *
 *   npx tsx --env-file=.env.local scripts/project-2027.ts           # cached payloads
 *   npx tsx --env-file=.env.local scripts/project-2027.ts --refresh # re-fetch (3 calls)
 *
 * What it weighs, and how heavily (see WEIGHTS): a power rating (net
 * efficiency and competition), then style tilts for offensive
 * efficiency, offensive rebounding, roster experience, turnover margin,
 * three-point shooting and defense. On top of that, an
 * identity bonus lifts teams that are elite at one thing: scoring, or
 * winning the margins on the glass and in turnovers.
 *
 * Steps:
 *   1. 2025-26 team stats for every D1 team, from CollegeBasketballData's
 *      season box-score totals (spot-checked against official ACC and Big
 *      East figures: turnover margin and 3PT totals match).
 *   2. Every stat adjusted for competition: a team's number is corrected
 *      by how its opponents allowed (or produced) that stat on average,
 *      iterated until it settles. Opponents come from the games table.
 *   3. Projected onto 2026-27 rosters through the players: each returning
 *      player and transfer brings his own offensive rating, rebounding,
 *      turnovers and shooting, weighted by minutes and corrected for the
 *      schedule his old team played. Minutes nobody on the roster played
 *      last season (freshmen, internationals, non-D1) are filled at half
 *      the program's edge. Defense and forced turnovers, which box scores
 *      can't pin on individuals, carry over by roster continuity.
 *   4. Competition counts twice: once inside every stat (step 2), and
 *      again as its own component, the strength of the team's conference.
 *   5. Each component becomes a z-score across D1, weighted, summed.
 *   6. Once 2026-27 games are played, real 2026-27 numbers take over.
 *      scripts/ncaa-stats.ts reads NCAA.com's official team totals; each
 *      component's z-score is blended as games / (games + BLEND_GAMES)
 *      actual, the rest projection. NCAA.com publishes no schedule, so
 *      in-season stats are adjusted by conference peers instead of
 *      exact opponents.
 *
 * Payloads are cached in scripts/.cache (gitignored). Writes
 * player_seasons rows for 2027 and lib/formula-2027.json for the page.
 * The method text in app/rankings/Formula.tsx describes this file; keep
 * the two in step.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEASON_FROM = 2026;
const SEASON_TO = 2027;
const CACHE = "scripts/.cache";

/**
 * Share of the base score. Must sum to 1. Two layers: a power rating
 * built the way the major rankings build theirs (net efficiency and the
 * competition it came against, 70%), then style tilts toward efficient
 * offense, offensive rebounding and an experienced roster (30%). The
 * identity bonus below is added on top.
 */
const WEIGHTS = {
  net: 0.45,
  competition: 0.25,
  offense: 0.1,
  oreb: 0.08,
  continuity: 0.05,
  turnovers: 0.03,
  three: 0.02,
  defense: 0.02,
} as const;

/**
 * Identity bonus: a team far above the field at one thing gets lifted
 * even if its overall numbers are ordinary. Two identities count: an
 * elite offense, and winning the margins (offensive rebounding and
 * turnover margin together). Each z-score point past the threshold adds
 * IDENTITY_BONUS to the score. Only the stronger identity counts.
 */
const IDENTITY_THRESHOLD = 2.5;
const IDENTITY_BONUS = 0.3;

// ── Tuning. Each one is described in the page's methodology. ─────────

/** Minutes of league-average play blended into each player's rates. */
const SHRINK_MINUTES = 300;
/** Three-point attempts of league-average shooting blended into a roster. */
const SHRINK_THREES = 200;
/** Share of a program's edge credited to minutes no known player fills. */
const PROGRAM_CARRYOVER = 0.8;
/** Team-level stats keep this much of last season's edge with nobody back... */
const CONTINUITY_BASE = 0.5;
/** ...plus this much more in proportion to returning minutes. */
const CONTINUITY_RETURN = 0.4;
/**
 * Share of the net-efficiency component taken from last season's
 * adjusted net, the team as it actually played, rather than the roster
 * projection. Programs that were good tend to stay good in ways a box
 * score can't see: coaching, recruiting, development.
 */
const PRIOR_WEIGHT = 0.4;
/** Credit, relative to a returner, for minutes a transfer played elsewhere in D1. */
const TRANSFER_CREDIT = 0.5;
/** Rounds of opponent adjustment. Converges well before this. */
const ADJUST_ROUNDS = 12;
const RANKED = 25;
const HONORABLE = 10;
/** Games at which a team's real 2026-27 numbers count half. */
const BLEND_GAMES = 10;
/** NCAA.com's 2026-27 totals, written by scripts/ncaa-stats.ts. */
const IN_SEASON_FILE = process.env.IN_SEASON_FILE ?? `${CACHE}/ncaa-team-${SEASON_TO}.json`;

/**
 * CBBD's 2027 rosters drop departed players but, for most teams, don't
 * yet list newcomers. These incoming transfers come from ESPN's AP
 * preseason poll breakdown (Oct 19, 2026). Roster facts only; no rankings
 * are taken from it. Matched to 2025-26 player stats by name and school.
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

/** Confirmed out for 2026-27; they count for nobody. [player, 2025-26 school] */
const OUT_FOR_SEASON: [player: string, school: string][] = [
  ["Solo Ball", "UConn"], // wrist surgery, medical redshirt (UConn, Apr 20)
  ["Donnie Freeman", "Syracuse"], // Achilles, St. John's transfer (Jul 2)
];

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// ── CBBD payload shapes (only the fields used) ────────────────────────

type BoxSide = {
  possessions: number;
  points: { total: number };
  threePointFieldGoals: { made: number; attempted: number };
  rebounds: { offensive: number; defensive: number };
  turnovers: { total: number };
};

type TeamSeason = {
  teamId: number;
  games: number;
  totalMinutes: number;
  teamStats: BoxSide;
  opponentStats: BoxSide;
};

type PlayerSeason = {
  teamId: number;
  athleteId: number;
  name: string;
  minutes: number;
  turnovers: number;
  usage: number | null;
  offensiveRating: number | null;
  offensiveReboundPct: number | null;
  threePointFieldGoals: { made: number; attempted: number };
};

type Player = PlayerSeason & { fromTeam: number };

type RosterTeam = {
  teamId: number;
  players: { id: number; name: string; startSeason: number | null }[];
};

/** Offense and its defensive mirror, for one stat. */
type Pair = { off: number; def: number };

type Factors = {
  eff: Pair; // points per 100 possessions scored / allowed
  oreb: Pair; // OREB% gained / OREB% conceded to opponents
  tov: Pair; // turnovers per 100 possessions committed / forced
  three: Pair; // 3PT% made / allowed
};

const FACTOR_KEYS = ["eff", "oreb", "tov", "three"] as const;
type FactorKey = (typeof FACTOR_KEYS)[number];
type WeightKey = keyof typeof WEIGHTS;

async function main() {
  const refresh = process.argv.includes("--refresh");
  const [rosters, teamSeasons, playerSeasons] = await Promise.all([
    cached<RosterTeam[]>("rosters-2027.json", "/teams/roster", SEASON_TO, refresh),
    cached<TeamSeason[]>("team-stats-2026.json", "/stats/team/season", SEASON_FROM, refresh),
    cached<PlayerSeason[]>("player-stats-2026.json", "/stats/player/season", SEASON_FROM, refresh),
  ]);

  const teams = await selectAll<{ id: number; school: string; conference: string | null }>(
    "teams", "id, school, conference", "id", { is_d1: true },
  );
  const games = await selectAll<{ home_team_id: number; away_team_id: number }>(
    "games", "id, home_team_id, away_team_id", "id", { season: SEASON_FROM },
  );

  const d1 = new Map(teams.map((t) => [t.id, t]));
  const box = new Map(
    teamSeasons
      .filter((t) => d1.has(t.teamId) && t.teamStats.possessions > 0)
      .map((t) => [t.teamId, t]),
  );

  // ── 1. Raw 2025-26 factors ─────────────────────────────────────────
  const raw = new Map<number, Factors>();
  for (const [id, t] of box) raw.set(id, factorsOf(t));

  // ── 2. Adjust for competition ─────────────────────────────────────
  const schedule = new Map<number, number[]>();
  for (const g of games) {
    if (!box.has(g.home_team_id) || !box.has(g.away_team_id)) continue;
    schedule.set(g.home_team_id, [...(schedule.get(g.home_team_id) ?? []), g.away_team_id]);
    schedule.set(g.away_team_id, [...(schedule.get(g.away_team_id) ?? []), g.home_team_id]);
  }

  // Offense and defense share one average per stat (every point scored
  // is a point allowed), taken across both sides.
  const league = {} as Record<FactorKey, number>;
  for (const k of FACTOR_KEYS) {
    league[k] = mean([...raw.values()].flatMap((f) => [f[k].off, f[k].def]));
  }

  // Additive adjustment, the same shape as adjusted efficiency: a team's
  // offense is corrected by how far its opponents' defenses sat from
  // average, and vice versa, repeated until the numbers stop moving.
  let adj = new Map([...raw].map(([id, f]) => [id, structuredClone(f)]));
  for (let round = 0; round < ADJUST_ROUNDS; round++) {
    const next = new Map<number, Factors>();
    for (const [id, f] of raw) {
      const opps = (schedule.get(id) ?? []).map((o) => adj.get(o)!).filter(Boolean);
      const out = structuredClone(f);
      if (opps.length) {
        for (const k of FACTOR_KEYS) {
          out[k].off = f[k].off - (mean(opps.map((o) => o[k].def)) - league[k]);
          out[k].def = f[k].def - (mean(opps.map((o) => o[k].off)) - league[k]);
        }
      }
      next.set(id, out);
    }
    // Re-anchor on the D1 average. Without this the whole league drifts a
    // little every round, and the drift lands on every team's numbers.
    for (const k of FACTOR_KEYS) {
      const offShift = mean([...next.values()].map((f) => f[k].off)) - league[k];
      const defShift = mean([...next.values()].map((f) => f[k].def)) - league[k];
      for (const f of next.values()) {
        f[k].off -= offShift;
        f[k].def -= defShift;
      }
    }
    adj = next;
  }

  // Conference strength: the average adjusted net efficiency of the
  // other teams in a team's conference, i.e. who it will mostly play.
  const confNet = new Map<string, { id: number; net: number }[]>();
  for (const [id, f] of adj) {
    const conf = d1.get(id)?.conference;
    if (!conf) continue;
    confNet.set(conf, [...(confNet.get(conf) ?? []), { id, net: f.eff.off - f.eff.def }]);
  }
  const competitionOf = (id: number) => {
    const others = (confNet.get(d1.get(id)?.conference ?? "") ?? []).filter((t) => t.id !== id);
    return others.length ? mean(others.map((t) => t.net)) : 0;
  };

  // ── 3. Project onto 2026-27 rosters ───────────────────────────────
  const d1Rosters = rosters.filter((t) => d1.has(t.teamId) && t.players.length);
  await saveRosters(d1Rosters);

  // A player who switched teams mid-season has a row per team; keep the
  // team where he played most.
  const players = new Map<number, Player>();
  for (const p of playerSeasons) {
    if (!box.has(p.teamId) || p.minutes <= 0) continue;
    const prev = players.get(p.athleteId);
    if (!prev || p.minutes > prev.minutes) players.set(p.athleteId, { ...p, fromTeam: p.teamId });
  }

  const schoolId = new Map(teams.map((t) => [t.school, t.id]));
  const findPlayer = (name: string, school: string) =>
    [...players.values()].find((p) => p.name === name && p.fromTeam === schoolId.get(school));

  const sidelined = new Set<number>();
  for (const [name, school] of OUT_FOR_SEASON) {
    const p = findPlayer(name, school);
    if (p) sidelined.add(p.athleteId);
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
      if (p) added.set(id, [...(added.get(id) ?? []), p.athleteId]);
      else console.warn(`  addition not matched: ${name} (${from} -> ${school})`);
    }
  }

  // League baselines for the player-level rates.
  const allP = [...players.values()];
  const lg = {
    ortg: weighted(allP, (p) => p.offensiveRating ?? 0, (p) => p.minutes * (p.usage ?? 0)),
    orebPct: weighted(allP, (p) => p.offensiveReboundPct ?? 0, (p) => p.minutes),
    tovPerMin: sum(allP.map((p) => p.turnovers)) / sum(allP.map((p) => p.minutes)),
    three:
      sum(allP.map((p) => p.threePointFieldGoals.made)) /
      sum(allP.map((p) => p.threePointFieldGoals.attempted)),
  };

  // Player box-score rates and team rates sit on slightly different
  // scales; calibrate so a team's own players, summed the same way,
  // land on the team's real numbers.
  const calib = calibrate(box, players, raw, lg);

  const rows = [];
  for (const t of d1Rosters) {
    const tb = box.get(t.teamId);
    const a = adj.get(t.teamId);
    const r = raw.get(t.teamId);
    if (!tb || !a || !r) continue;

    const teamMinutes = tb.totalMinutes * 5;
    const hasNewcomers = t.players.some((p) => p.startSeason === SEASON_TO);
    const ids = new Set([...t.players.map((p) => p.id), ...(added.get(t.teamId) ?? [])]);

    let known = 0;
    let returningMin = 0;
    let transferMin = 0;
    let ortgW = 0;
    let ortgSum = 0;
    let orebSum = 0;
    let tovSum = 0;
    let threeMade = 0;
    let threeAtt = 0;
    let threeSched = 0;
    const transfersIn: { name: string; from: string; minutes: number }[] = [];

    for (const id of ids) {
      if (sidelined.has(id)) continue;
      const p = players.get(id);
      if (!p) continue;

      // Schedule correction carried from the player's old team.
      const fromAdj = adj.get(p.fromTeam)!;
      const fromRaw = raw.get(p.fromTeam)!;
      const share = p.minutes / teamMinutes;
      const shrink = p.minutes / (p.minutes + SHRINK_MINUTES);

      known += share;
      if (p.fromTeam === t.teamId) returningMin += p.minutes;
      else {
        transferMin += p.minutes;
        transfersIn.push({
          name: p.name,
          from: d1.get(p.fromTeam)?.school ?? "non-D1",
          minutes: p.minutes,
        });
      }

      const ortg =
        (lg.ortg + shrink * ((p.offensiveRating ?? lg.ortg) - lg.ortg)) * calib.eff +
        (fromAdj.eff.off - fromRaw.eff.off);
      const w = share * (p.usage ?? 20);
      ortgW += w;
      ortgSum += w * ortg;

      const orebPct = lg.orebPct + shrink * ((p.offensiveReboundPct ?? lg.orebPct) - lg.orebPct);
      orebSum += share * ((orebPct / 100) * calib.oreb + (fromAdj.oreb.off - fromRaw.oreb.off));

      const tovRate = lg.tovPerMin + shrink * (p.turnovers / p.minutes - lg.tovPerMin);
      tovSum += share * (tovRate * calib.tov + (fromAdj.tov.off - fromRaw.tov.off));

      const att = p.threePointFieldGoals.attempted;
      threeMade += p.threePointFieldGoals.made;
      threeAtt += att;
      threeSched += att * (fromAdj.three.off - fromRaw.three.off);
    }

    // More proven minutes than one team can play: scale to a full team.
    const scale = known > 1 ? 1 / known : 1;
    const knownShare = Math.min(known, 1);
    const unknown = 1 - knownShare;
    const returning = Math.min(returningMin / teamMinutes, 1);
    // Experience: minutes back, plus half credit for minutes proven
    // elsewhere in Division I. A team rebuilt with established transfers
    // isn't the same as one rebuilt with unknowns.
    const experience = Math.min((returningMin + TRANSFER_CREDIT * transferMin) / teamMinutes, 1);
    const fill = (k: FactorKey) => league[k] + PROGRAM_CARRYOVER * (a[k].off - league[k]);
    const carry = (k: FactorKey) =>
      league[k] + (a[k].def - league[k]) * (CONTINUITY_BASE + CONTINUITY_RETURN * returning);

    const proj = {
      offense: knownShare * (ortgW ? ortgSum / ortgW : league.eff) + unknown * fill("eff"),
      oreb: orebSum * scale + unknown * fill("oreb"),
      tovCommitted: tovSum * scale + unknown * fill("tov"),
      tovForced: carry("tov"),
      three:
        (threeMade + lg.three * SHRINK_THREES) / (threeAtt + SHRINK_THREES) +
        (threeAtt ? threeSched / threeAtt : 0),
      defense: carry("eff"),
      competition: competitionOf(t.teamId),
      lastNet: a.eff.off - a.eff.def,
    };

    const team = d1.get(t.teamId)!;
    rows.push({
      team_id: t.teamId,
      school: team.school,
      conference: team.conference,
      proj,
      returning,
      experience,
      incomplete: !hasNewcomers && !added.has(t.teamId),
      transfers_in: transfersIn
        .sort((x, y) => y.minutes - x.minutes)
        .slice(0, 3)
        .map(({ name, from }) => ({ name, from })),
    });
  }

  // ── 4. Score ───────────────────────────────────────────────────────
  // Every component oriented so higher is better before z-scoring.
  const parts: Record<WeightKey, number[]> = {
    net: rows.map(
      (r) => (1 - PRIOR_WEIGHT) * (r.proj.offense - r.proj.defense) + PRIOR_WEIGHT * r.proj.lastNet,
    ),
    offense: rows.map((r) => r.proj.offense),
    oreb: rows.map((r) => r.proj.oreb),
    turnovers: rows.map((r) => r.proj.tovForced - r.proj.tovCommitted),
    three: rows.map((r) => r.proj.three),
    defense: rows.map((r) => -r.proj.defense),
    competition: rows.map((r) => r.proj.competition),
    // Share of last season's minutes back with the same team.
    continuity: rows.map((r) => r.experience),
  };
  const keys = Object.keys(WEIGHTS) as WeightKey[];
  const z = Object.fromEntries(keys.map((k) => [k, zscores(parts[k])])) as Record<WeightKey, number[]>;

  // ── 6. Blend in real 2026-27 numbers ──────────────────────────────
  const live = inSeason(rows.map((r) => r.team_id), d1);
  const weightOf = rows.map((r) => {
    const g = live.byTeam.get(r.team_id)?.games ?? 0;
    return g / (g + BLEND_GAMES);
  });
  if (live.byTeam.size) {
    for (const k of keys) {
      if (k === "competition" || k === "continuity") continue; // same input either way
      rows.forEach((r, i) => {
        const az = live.z[k].get(r.team_id);
        if (az !== undefined) z[k][i] = weightOf[i] * az + (1 - weightOf[i]) * z[k][i];
      });
    }
  }

  // Shown stats and their ranks: real numbers once a team has played.
  const shown = rows.map((r) => live.byTeam.get(r.team_id)?.stats ?? {
    offense: r.proj.offense,
    oreb: r.proj.oreb,
    turnovers: r.proj.tovForced - r.proj.tovCommitted,
    three: r.proj.three,
    defense: r.proj.defense,
  });
  const shownParts: Record<WeightKey, number[]> = {
    net: shown.map((x) => x.offense - x.defense),
    offense: shown.map((x) => x.offense),
    oreb: shown.map((x) => x.oreb),
    turnovers: shown.map((x) => x.turnovers),
    three: shown.map((x) => x.three),
    defense: shown.map((x) => -x.defense),
    competition: parts.competition,
    continuity: parts.continuity,
  };
  const ranks = Object.fromEntries(keys.map((k) => [k, rankDesc(shownParts[k])])) as Record<WeightKey, number[]>;
  // Identity: margins is its own z-score of the two hustle stats combined,
  // so "elite at margins" means elite against the field, not an average
  // of two good-not-great numbers.
  const marginsZ = zscores(rows.map((_, i) => z.oreb[i] + z.turnovers[i]));
  const identity = rows.map((_, i) => {
    const offense = z.offense[i] - IDENTITY_THRESHOLD;
    const margins = marginsZ[i] - IDENTITY_THRESHOLD;
    const best = Math.max(offense, margins);
    if (best <= 0) return { bonus: 0, label: null as string | null };
    return {
      bonus: IDENTITY_BONUS * best,
      label: offense >= margins ? "Elite offense" : "Wins the margins",
    };
  });
  const scores = rows.map(
    (_, i) => sum(keys.map((k) => WEIGHTS[k] * z[k][i])) + identity[i].bonus,
  );

  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => scores[y.i] - scores[x.i])
    .slice(0, RANKED + HONORABLE);

  const maxGames = Math.max(0, ...[...live.byTeam.values()].map((t) => t.games));
  const out = {
    season: SEASON_TO,
    generated_at: new Date().toISOString(),
    stage: maxGames > 0 ? "in-season" : "preseason",
    in_season: live.byTeam.size
      ? { source: live.source, fetched: live.fetched, max_games: maxGames, blend_games: BLEND_GAMES }
      : null,
    weights: WEIGHTS,
    identity: { threshold: IDENTITY_THRESHOLD, bonus: IDENTITY_BONUS },
    params: {
      SHRINK_MINUTES, SHRINK_THREES, PROGRAM_CARRYOVER, PRIOR_WEIGHT, TRANSFER_CREDIT, CONTINUITY_BASE,
      CONTINUITY_RETURN, RANKED, HONORABLE, BLEND_GAMES,
    },
    sources: {
      stats: "CollegeBasketballData season box-score totals, 2025-26",
      in_season: "https://www.ncaa.com/stats/basketball-men/d1/2027/team",
      rosters: "CollegeBasketballData /teams/roster, season 2027",
      additions:
        "https://www.espn.com/mens-college-basketball/story/_/id/50191393/ap-mens-preseason-top-25-poll-reaction-2026-27",
      checks: [
        "https://theacc.com/stats.aspx?path=mbball&year=2025",
        "https://www.bigeast.com/stats.aspx?path=mbball&year=2025",
      ],
    },
    teams_rated: rows.length,
    rows: ordered.map(({ r, i }, n) => ({
      rk: n + 1,
      team_id: r.team_id,
      school: r.school,
      conference: r.conference,
      score: round(scores[i], 3),
      games: live.byTeam.get(r.team_id)?.games ?? 0,
      actual_weight: round(weightOf[i], 2),
      off_eff: round(shown[i].offense, 1),
      oreb_pct: round(shown[i].oreb * 100, 1),
      to_margin: round(shown[i].turnovers, 1),
      three_pct: round(shown[i].three * 100, 1),
      def_eff: round(shown[i].defense, 1),
      conf_strength: round(r.proj.competition, 1),
      ranks: Object.fromEntries(keys.map((k) => [k, ranks[k][i]])) as Record<WeightKey, number>,
      identity: identity[i].label,
      returning: round(r.returning, 3),
      experience: round(r.experience, 3),
      incomplete: r.incomplete,
      transfers_in: r.transfers_in,
    })),
  };

  writeFileSync("lib/formula-2027.json", JSON.stringify(out, null, 2) + "\n");
  console.log(`Rated ${rows.length} teams (calibration ${JSON.stringify(calib)}). Top 10:`);
  for (const r of out.rows.slice(0, 10)) {
    console.log(
      `  ${r.rk}. ${r.school} ${r.score} (off ${r.off_eff}, oreb ${r.oreb_pct}, ` +
        `tom ${r.to_margin}, 3p ${r.three_pct}, def ${r.def_eff})`,
    );
  }
}

// ── In-season (NCAA.com) ──────────────────────────────────────────────

type NcaaTotals = Record<
  | "games" | "pts" | "opp_pts" | "fgm" | "fga" | "opp_fgm" | "opp_fga" | "fta"
  | "oreb" | "dreb" | "tpm" | "tpa" | "opp_tpm" | "opp_tpa" | "tov" | "opp_tov",
  number
>;

type Shown = { offense: number; oreb: number; turnovers: number; three: number; defense: number };

/**
 * Real 2026-27 numbers from NCAA.com's totals, adjusted by conference
 * peers, as z-scores per component. Empty before the season starts.
 */
function inSeason(teamIds: number[], d1: Map<number, { conference: string | null }>) {
  const empty = {
    byTeam: new Map<number, { games: number; stats: Shown }>(),
    z: {} as Record<WeightKey, Map<number, number>>,
    source: "",
    fetched: "",
  };
  if (!existsSync(IN_SEASON_FILE)) return empty;
  const file = JSON.parse(readFileSync(IN_SEASON_FILE, "utf8")) as {
    source: string;
    fetched: string;
    teams: Record<string, NcaaTotals>;
  };

  // NCAA.com totals -> per-possession factors. Possessions use the
  // standard estimate; offensive rebounding is per missed shot, since the
  // opponents' defensive rebounds aren't published.
  const raw = new Map<number, Factors>();
  for (const id of teamIds) {
    const t = file.teams[id];
    if (!t || !t.games) continue;
    const poss = t.fga - t.oreb + t.tov + 0.475 * t.fta;
    const misses = t.fga - t.fgm;
    const oppMisses = t.opp_fga - t.opp_fgm;
    raw.set(id, {
      eff: { off: (100 * t.pts) / poss, def: (100 * t.opp_pts) / poss },
      oreb: { off: t.oreb / misses, def: Math.max(oppMisses - t.dreb, 0) / oppMisses },
      tov: { off: (100 * t.tov) / poss, def: (100 * t.opp_tov) / poss },
      three: { off: t.tpm / t.tpa, def: t.opp_tpm / t.opp_tpa },
    });
  }
  if (!raw.size) return empty;

  const league = {} as Record<FactorKey, number>;
  for (const k of FACTOR_KEYS) {
    league[k] = mean([...raw.values()].flatMap((f) => [f[k].off, f[k].def]));
  }

  // Conference peers stand in for the schedule NCAA.com doesn't publish.
  const peers = (id: number) =>
    [...raw.keys()].filter((o) => o !== id && d1.get(o)?.conference === d1.get(id)?.conference);
  const stats = new Map<number, Shown>();
  for (const [id, f] of raw) {
    const p = peers(id).map((o) => raw.get(o)!);
    const a = structuredClone(f);
    if (p.length) {
      for (const k of FACTOR_KEYS) {
        a[k].off = f[k].off - (mean(p.map((o) => o[k].def)) - league[k]);
        a[k].def = f[k].def - (mean(p.map((o) => o[k].off)) - league[k]);
      }
    }
    stats.set(id, {
      offense: a.eff.off,
      oreb: a.oreb.off,
      turnovers: a.tov.def - a.tov.off,
      three: a.three.off,
      defense: a.eff.def,
    });
  }

  const ids = [...stats.keys()];
  const comp = (pick: (s: Shown) => number) => {
    const zs = zscores(ids.map((id) => pick(stats.get(id)!)));
    return new Map(ids.map((id, i) => [id, zs[i]]));
  };
  return {
    byTeam: new Map(ids.map((id) => [id, { games: file.teams[id].games, stats: stats.get(id)! }])),
    z: {
      net: comp((s) => s.offense - s.defense),
      offense: comp((s) => s.offense),
      oreb: comp((s) => s.oreb),
      turnovers: comp((s) => s.turnovers),
      three: comp((s) => s.three),
      defense: comp((s) => -s.defense),
    } as Record<WeightKey, Map<number, number>>,
    source: file.source,
    fetched: file.fetched,
  };
}

// ── Factors ───────────────────────────────────────────────────────────

function factorsOf(t: TeamSeason): Factors {
  const o = t.teamStats;
  const d = t.opponentStats;
  return {
    eff: {
      off: (100 * o.points.total) / o.possessions,
      def: (100 * d.points.total) / d.possessions,
    },
    oreb: {
      off: o.rebounds.offensive / (o.rebounds.offensive + d.rebounds.defensive),
      def: d.rebounds.offensive / (d.rebounds.offensive + o.rebounds.defensive),
    },
    tov: {
      off: (100 * o.turnovers.total) / o.possessions,
      def: (100 * d.turnovers.total) / d.possessions,
    },
    three: {
      off: o.threePointFieldGoals.made / o.threePointFieldGoals.attempted,
      def: d.threePointFieldGoals.made / d.threePointFieldGoals.attempted,
    },
  };
}

/**
 * Scale factors so each team's own 2025-26 players, combined the way the
 * projection combines them, land on that team's real numbers (median
 * across teams).
 */
function calibrate(
  box: Map<number, TeamSeason>,
  players: Map<number, Player>,
  raw: Map<number, Factors>,
  lg: { ortg: number },
) {
  const byTeam = new Map<number, Player[]>();
  for (const p of players.values()) byTeam.set(p.fromTeam, [...(byTeam.get(p.fromTeam) ?? []), p]);

  const eff: number[] = [];
  const oreb: number[] = [];
  const tov: number[] = [];
  for (const [id, list] of byTeam) {
    const f = raw.get(id)!;
    const minutes = box.get(id)!.totalMinutes * 5;
    const ortg = weighted(list, (p) => p.offensiveRating ?? lg.ortg, (p) => p.minutes * (p.usage ?? 20));
    const orebSum = sum(list.map((p) => (p.minutes / minutes) * ((p.offensiveReboundPct ?? 0) / 100)));
    const tovPerMin = sum(list.map((p) => p.turnovers)) / sum(list.map((p) => p.minutes));
    if (ortg) eff.push(f.eff.off / ortg);
    if (orebSum) oreb.push(f.oreb.off / orebSum);
    // Turnovers per player-minute -> per 100 possessions.
    if (tovPerMin) tov.push(f.tov.off / tovPerMin);
  }
  return { eff: round(median(eff), 4), oreb: round(median(oreb), 4), tov: round(median(tov), 2) };
}

// ── Helpers ───────────────────────────────────────────────────────────

function sum(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}

function mean(xs: number[]) {
  return xs.length ? sum(xs) / xs.length : 0;
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 1;
}

function weighted<T>(xs: T[], value: (x: T) => number, weight: (x: T) => number) {
  const w = sum(xs.map(weight));
  return w ? sum(xs.map((x) => value(x) * weight(x))) / w : 0;
}

function zscores(xs: number[]) {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
  return xs.map((x) => (x - m) / sd);
}

/** 1 for the highest value. */
function rankDesc(xs: number[]) {
  const rk = new Array<number>(xs.length);
  xs.map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i], n) => (rk[i] = n + 1));
  return rk;
}

function round(n: number, places: number) {
  return Number(n.toFixed(places));
}

/** Read a cached CBBD payload, or fetch it (one call, logged to api_calls). */
async function cached<T>(file: string, path: string, season: number, refresh: boolean): Promise<T> {
  const at = `${CACHE}/${file}`;
  if (!refresh && existsSync(at)) return JSON.parse(readFileSync(at, "utf8"));

  const started = Date.now();
  const res = await fetch(`https://api.collegebasketballdata.com${path}?season=${season}`, {
    headers: { Authorization: `Bearer ${env("CBBD_API_KEY")}` },
  });
  await db.from("api_calls").insert({
    endpoint: path,
    params: { season: String(season) },
    status: res.status,
    ms: Date.now() - started,
  });
  if (!res.ok) throw new Error(`CBBD ${res.status} ${path}: ${await res.text()}`);
  const body = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(at, body);
  return JSON.parse(body);
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
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(columns);
    for (const [col, v] of Object.entries(eq)) q = q.eq(col, v);
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
