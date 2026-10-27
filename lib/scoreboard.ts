import { unstable_cache } from "next/cache";
import type { WireEntry } from "@/app/LiveWire";

/**
 * The day's biggest games and best scoring nights, for the ticker.
 *
 * Read straight from ESPN's public scoreboard (the JSON espn.com's own
 * scoreboard page loads): no key, nothing stored, and no calls against
 * the CBBD budget. Scores are live during games and cached for two
 * minutes, so a busy Saturday costs ESPN a request every two minutes at
 * most, not one per visitor.
 *
 * If ESPN is down or changes shape, this returns nothing and the ticker
 * carries on with news alone.
 */

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

/** Games shown. Ranked teams, upsets and close finishes go first. */
const MAX_GAMES = 8;
/** Scoring lines shown, best first. */
const MAX_SCORERS = 5;
/** Below this, a scoring night isn't ticker news. */
const MIN_POINTS = 20;
/**
 * Bonus for being today's game. Enough to put a live or fresh result
 * ahead of a similar one from last night, not enough to let an unranked
 * close game bump last night's top-10 matchup.
 */
const TODAY_BONUS = 8;

type Side = {
  school: string;
  rank: number | null;
  score: number;
  winner: boolean;
  leader: { name: string; points: number } | null;
};

export type Game = {
  id: string;
  url: string;
  start: string;
  state: "pre" | "in" | "post";
  detail: string;
  overtime: boolean;
  sides: [Side, Side];
};

export async function getScoreboardWire(): Promise<WireEntry[]> {
  const [now, before] = await Promise.all([games(easternDay(0)), games(easternDay(-1))]);
  return buildWire(now, before);
}

/** Today's and yesterday's games -> ticker items. Separate so it can be tested. */
export function buildWire(now: Game[], before: Game[]): WireEntry[] {
  const today = new Set(now.map((g) => g.id));
  const merged = [...now.filter((g) => g.state !== "pre"), ...before.filter((g) => g.state === "post")];
  // A late tip can land on both days' scoreboards; keep it once.
  const pool = [...new Map(merged.map((g) => [g.id, g])).values()];
  const rank = (g: Game) => importance(g) + (today.has(g.id) ? TODAY_BONUS : 0);

  const top = [...pool].sort((a, b) => rank(b) - rank(a)).slice(0, MAX_GAMES);
  // Live games lead: they're the only items that change while you watch.
  top.sort((a, b) => Number(b.state === "in") - Number(a.state === "in"));

  const scorers = pool
    .filter((g) => g.state === "post")
    .flatMap((g) =>
      g.sides.map((s, i) => ({ g, s, opp: g.sides[1 - i] }))
        .filter(({ s }) => s.leader && s.leader.points >= MIN_POINTS),
    )
    .sort((a, b) => b.s.leader!.points - a.s.leader!.points)
    .slice(0, MAX_SCORERS);

  return [
    ...top.map((g) => ({
      id: `game-${g.id}`,
      kind: (g.state === "in" ? "live" : "score") as WireEntry["kind"],
      headline: scoreLine(g),
      url: g.url,
      published_at: g.start,
      source: null,
    })),
    ...scorers.map(({ g, s, opp }) => ({
      id: `pts-${g.id}-${s.school}`,
      kind: "scorer" as const,
      headline: `${s.leader!.name}, ${s.school}: ${s.leader!.points} pts ${s.winner ? "in win over" : "vs"} ${named(opp)}`,
      url: g.url,
      published_at: g.start,
      source: null,
    })),
  ];
}

/** "No. 3 Florida 84, No. 12 Kansas 79 (OT)"; live games add the clock. */
function scoreLine(g: Game) {
  const [a, b] = [...g.sides].sort((x, y) => y.score - x.score);
  const line = `${named(a)} ${a.score}, ${named(b)} ${b.score}`;
  if (g.state === "in") return `${line} · ${g.detail}`;
  return g.overtime ? `${line} (${g.detail.replace(/^Final\//, "")})` : line;
}

function named(s: Side) {
  return s.rank ? `No. ${s.rank} ${s.school}` : s.school;
}

/**
 * How much a game matters to a national reader: ranked teams (higher
 * ranks count more), an upset of a ranked team, a close finish.
 */
function importance(g: Game) {
  const weight = (s: Side) => (s.rank ? 26 - s.rank : 0);
  const [x, y] = g.sides;
  let score = weight(x) + weight(y);
  const done = g.state === "post";
  const winner = g.sides.find((s) => s.winner);
  const loser = g.sides.find((s) => !s.winner);
  if (done && winner && loser?.rank && (!winner.rank || winner.rank > loser.rank)) {
    score += 15 + weight(loser); // upset
  }
  if (Math.abs(x.score - y.score) <= 5) score += 5;
  if (g.overtime) score += 3;
  return score;
}

/** One day's games, trimmed to what the ticker needs, cached two minutes. */
const games = unstable_cache(
  async (day: string): Promise<Game[]> => {
    try {
      const res = await fetch(`${SCOREBOARD}?dates=${day.replace(/-/g, "")}&groups=50&limit=400`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { events?: EspnEvent[] };
      return (body.events ?? []).flatMap(toGame);
    } catch {
      return [];
    }
  },
  ["espn-scoreboard"],
  { revalidate: 120 },
);

// ── ESPN payload (only the fields used) ─────────────────────────────────

type EspnCompetitor = {
  homeAway: string;
  winner?: boolean;
  score?: string;
  curatedRank?: { current?: number };
  team?: { location?: string; shortDisplayName?: string };
  leaders?: { name: string; leaders?: { value: number; athlete?: { displayName?: string } }[] }[];
};

export type EspnEvent = {
  id: string;
  date: string;
  links?: { href: string; rel?: string[] }[];
  competitions?: {
    competitors?: EspnCompetitor[];
    status?: { period?: number; type?: { state?: string; shortDetail?: string } };
  }[];
};

export function toGame(e: EspnEvent): Game[] {
  const c = e.competitions?.[0];
  const teams = c?.competitors ?? [];
  const state = c?.status?.type?.state;
  if (teams.length !== 2 || (state !== "pre" && state !== "in" && state !== "post")) return [];

  const side = (t: EspnCompetitor): Side => {
    const rank = t.curatedRank?.current;
    const pts = t.leaders?.find((l) => l.name === "points")?.leaders?.[0];
    return {
      school: t.team?.location ?? t.team?.shortDisplayName ?? "?",
      // ESPN marks unranked as 99.
      rank: rank && rank <= 25 ? rank : null,
      score: Number(t.score ?? 0),
      winner: !!t.winner,
      leader: pts?.athlete?.displayName ? { name: pts.athlete.displayName, points: pts.value } : null,
    };
  };

  // Away team first, the way a scoreboard reads.
  const away = (t: EspnCompetitor) => (t.homeAway === "away" ? 0 : 1);
  const ordered = [...teams].sort((a, b) => away(a) - away(b));
  const detail = c?.status?.type?.shortDetail ?? "";
  return [
    {
      id: e.id,
      url:
        e.links?.find((l) => l.rel?.includes("summary"))?.href ??
        `https://www.espn.com/mens-college-basketball/game/_/gameId/${e.id}`,
      start: e.date,
      state,
      detail,
      overtime: (c?.status?.period ?? 2) > 2,
      sides: [side(ordered[0]), side(ordered[1])],
    },
  ];
}

/** YYYY-MM-DD in US Eastern time, offset by `days`. */
function easternDay(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}
