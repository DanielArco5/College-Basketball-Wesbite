import type { SupabaseClient } from "@supabase/supabase-js";

export const RATINGS_SEASON = 2026;

/** One row of team_ratings, plus the per-side ranks computed below. */
export type TeamRating = {
  team_id: number;
  school: string;
  conference: string | null;
  adj_off: number;
  adj_def: number;
  net: number;
  games: number;
  rk: number;
  off_rk: number;
  def_rk: number;
};

export type RatingSort = "net" | "off" | "def";

/**
 * Every D1 team's opponent-adjusted rating for the season.
 *
 * team_ratings only carries the overall rank, so offense and defense
 * ranks are worked out here. Defense ranks ascending: fewer points
 * allowed per shot is better.
 */
export async function loadRatings(
  db: SupabaseClient,
): Promise<{ data: TeamRating[]; error: string | null }> {
  const { data, error } = await db
    .from("team_ratings")
    .select("team_id, school, conference, adj_off, adj_def, net, games, rk")
    .eq("season", RATINGS_SEASON)
    .order("rk");

  if (error) return { data: [], error: error.message };

  const rows = (data ?? []) as Omit<TeamRating, "off_rk" | "def_rk">[];
  const offRank = rankBy(rows, (r) => -r.adj_off);
  const defRank = rankBy(rows, (r) => r.adj_def);

  return {
    data: rows.map((r) => ({
      ...r,
      off_rk: offRank.get(r.team_id)!,
      def_rk: defRank.get(r.team_id)!,
    })),
    error: null,
  };
}

export function sortRatings(rows: TeamRating[], sort: RatingSort) {
  const key = sort === "off" ? "off_rk" : sort === "def" ? "def_rk" : "rk";
  return [...rows].sort((a, b) => a[key] - b[key]);
}

/** Lowest score ranks 1. Ties break by team_id so ranks are stable. */
function rankBy<T extends { team_id: number }>(rows: T[], score: (r: T) => number) {
  const sorted = [...rows].sort(
    (a, b) => score(a) - score(b) || a.team_id - b.team_id,
  );
  return new Map(sorted.map((r, i) => [r.team_id, i + 1]));
}

/** Points per field goal attempt, three decimals, as the page shows it. */
export function pps(n: number) {
  return n.toFixed(3);
}
