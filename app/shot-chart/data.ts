import { cache } from "react";
import { createServerClient } from "@/lib/supabase-server";

/**
 * Shot-chart reads that don't depend on which player or team is open.
 * Each is wrapped in React's cache(), so however many times one render
 * asks (the page, generateMetadata, a nested component), the query runs
 * once. The memo lasts for a single render only: it does not carry over
 * from one request, or one statically generated page, to the next.
 */

// Supabase returns at most 1,000 rows per request, whatever .limit() asks
// for, so anything that can exceed that is read in pages.
const PAGE_SIZE = 1000;

export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

export type PickerRow = {
  player_id: number;
  player_name: string;
  team_id: number;
  attempts: number;
};

/**
 * Every player in a season with at least `minAttempts` shots, non-D1
 * included: around five pages of rows. Sorted by id as well as name so
 * pages don't shuffle players who share a name across the page boundary.
 */
export const getPickerList = cache(async (season: number, minAttempts: number) => {
  const db = createServerClient();
  return fetchAll<PickerRow>((from, to) =>
    db
      .from("player_season_totals")
      .select("player_id, player_name, team_id, attempts")
      .eq("season", season)
      .gte("attempts", minAttempts)
      .order("player_name")
      .order("player_id")
      .range(from, to),
  );
});

/** Which season and zone each priors table has rows for. */
export const getPriors = cache(async () => {
  const db = createServerClient();
  const [{ data: player }, { data: team }] = await Promise.all([
    db.from("zone_priors").select("season, zone"),
    db.from("team_zone_priors").select("season, zone"),
  ]);
  return {
    player: (player ?? []) as { season: number; zone: string }[],
    team: (team ?? []) as { season: number; zone: string }[],
  };
});

/** The D1 average FG% in each zone for one season. */
export const getBaselines = cache(async (season: number) => {
  const db = createServerClient();
  const { data, error } = await db
    .from("zone_baselines")
    .select("zone, fg_pct")
    .eq("season", season);
  return { data: (data ?? []) as { zone: string; fg_pct: number }[], error };
});
