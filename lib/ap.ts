import { unstable_cache } from "next/cache";
import apFinal from "./ap-final.json";
import { createServerClient } from "./supabase-server";

/**
 * AP Top 25 by season (named by the year it ends: 2027 is 2026-27).
 *
 * Finished seasons use their final poll, saved in lib/ap-final.json by
 * scripts/ap-final.ts. The live season reads ESPN's public rankings feed
 * (no key, nothing stored), cached for an hour: the poll comes out once a
 * week, on Mondays.
 */

export const LIVE_AP_SEASON = 2027;

export type ApRow = { rank: number; school: string; team_id: number | null; record: string | null };
export type ApPoll = { season: number; label: string; rows: ApRow[] };

const FEED = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings";

type Saved = Record<string, { rows: ApRow[] }>;

export async function getApPoll(season: number): Promise<ApPoll | null> {
  const saved = (apFinal as Saved)[season];
  if (saved) return { season, label: "Final", rows: saved.rows };
  if (season === LIVE_AP_SEASON) return livePoll();
  return null;
}

/** Every season with a poll, newest first. */
export async function getApPolls(seasons: number[]): Promise<ApPoll[]> {
  const polls = await Promise.all(seasons.map(getApPoll));
  return polls.filter((p): p is ApPoll => p !== null && p.rows.length > 0);
}

/** A team's AP rank in `season`, or null when unranked. */
export async function apRankOf(teamId: number, season: number) {
  const poll = await getApPoll(season);
  const row = poll?.rows.find((r) => r.team_id === teamId);
  return row && poll ? { rank: row.rank, label: poll.label } : null;
}

type EspnRankings = {
  rankings?: {
    type: string;
    occurrence?: { displayValue?: string };
    ranks: { current: number; recordSummary?: string; team: { id: string; location: string } }[];
  }[];
};

const livePoll = unstable_cache(
  async (): Promise<ApPoll | null> => {
    try {
      const res = await fetch(FEED, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const body = (await res.json()) as EspnRankings;
      const ap = body.rankings?.find((r) => r.type === "ap");
      if (!ap) return null;

      // ESPN's team ids are our teams.source_id.
      const { data: teams } = await createServerClient()
        .from("teams")
        .select("id, school, source_id")
        .in("source_id", ap.ranks.map((r) => r.team.id));
      const byEspn = new Map((teams ?? []).map((t) => [String(t.source_id), t]));

      return {
        season: LIVE_AP_SEASON,
        label: ap.occurrence?.displayValue ?? "Latest",
        rows: ap.ranks.map((r) => {
          const t = byEspn.get(r.team.id);
          return {
            rank: r.current,
            school: t?.school ?? r.team.location,
            team_id: t?.id ?? null,
            record: r.recordSummary ?? null,
          };
        }),
      };
    } catch {
      return null;
    }
  },
  ["espn-ap-poll"],
  { revalidate: 3600 },
);
