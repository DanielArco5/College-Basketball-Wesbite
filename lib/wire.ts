import type { WireEntry } from "@/app/LiveWire";
import { getScoreboardWire } from "./scoreboard";
import { createServerClient } from "./supabase-server";

/**
 * What Live Wire shows, in priority order:
 *
 *   1. Scores: live games, then the day's biggest finals
 *   2. The day's best scoring nights
 *   3. Injuries from the past week, season-enders first
 *   4. Everything else, newest first
 *
 * Shared by the ticker and the home page's Live Wire tab so the two
 * never disagree. Server-only; it uses the secret key.
 */

/** Injuries this recent jump the queue; older ones fall in with the rest. */
const INJURY_DAYS = 7;
const MAX_INJURIES = 6;
const MAX_OTHER = 12;

/** Headline words that make an injury major rather than day-to-day. */
const MAJOR =
  /\b(out for (the )?season|season-ending|torn|tears?|acl|achilles|surgery|indefinitely|fracture\w*|broken|medical redshirt|miss(es)? (the )?(rest|remainder))\b/i;

export async function getWire(): Promise<WireEntry[]> {
  const db = createServerClient();
  const since = new Date(Date.now() - INJURY_DAYS * 86_400_000).toISOString();

  // "*" rather than a column list: before supabase/automation.sql adds the
  // source column, naming it would fail the read. A failed read leaves
  // that group empty instead of taking the ticker down.
  const [games, injuries, latest] = await Promise.all([
    getScoreboardWire(),
    db
      .from("live_wire_entries")
      .select("*")
      .eq("is_live", true)
      .eq("kind", "injury")
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(20),
    db
      .from("live_wire_entries")
      .select("*")
      .eq("is_live", true)
      .order("published_at", { ascending: false })
      .limit(MAX_INJURIES + MAX_OTHER),
  ]);

  const hurt = ((injuries.data ?? []) as WireEntry[])
    .map((e, i) => ({ e, major: MAJOR.test(e.headline), i }))
    .sort((a, b) => Number(b.major) - Number(a.major) || a.i - b.i)
    .slice(0, MAX_INJURIES)
    .map(({ e }) => e);

  const shown = new Set(hurt.map((e) => e.id));
  const rest = ((latest.data ?? []) as WireEntry[])
    .filter((e) => !shown.has(e.id))
    .slice(0, MAX_OTHER);

  return [...games, ...hurt, ...rest];
}
