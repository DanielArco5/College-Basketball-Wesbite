/**
 * Keep the live season's shot charts current.
 *
 *   npm run update-shots              # through yesterday (Eastern)
 *   npm run update-shots -- --today   # through today, games finished so far
 *   npm run update-shots -- --no-refresh     # import only
 *   npm run update-shots -- --refresh-only   # refresh the summaries only
 *
 * Imports every game day since the last run, then refreshes the
 * shot-chart summaries. The day the last run ended on is always fetched
 * again: if that run was an hourly --today pass, the day's late games
 * (West Coast, Hawai'i) weren't over yet. Safe to
 * run as often as you like: days already imported are skipped by the
 * checkpoint, and re-imported plays are de-duplicated.
 *
 * Costs about one CollegeBasketballData call per game day, roughly 150
 * over a full season, well inside the 1,000-a-month free tier. Shot
 * locations exist only there; NCAA.com doesn't publish them.
 *
 * Last season (2025-26) is never touched: it has its own season key and
 * its own checkpoint, and nothing here asks for its dates.
 *
 * The daily job imports with --no-refresh and runs --refresh-only as its
 * last step: the refresh loads the database for a few minutes, and
 * anything that talks to it in that time can fail.
 *
 * Needs supabase/refresh-shot-views.sql run once in the SQL editor.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEASON = 2027;
/** First day of the 2026-27 regular season (Notre Dame at Villanova
 *  tipped a day before the rest, on November 1). */
const SEASON_START = "2026-11-01";
/** Last day plays can exist: through the national championship. */
const SEASON_END = "2027-04-12";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function main() {
  if (process.argv.includes("--refresh-only")) return refresh();

  const through = easternDate(process.argv.includes("--today") ? 0 : -1);
  const to = through < SEASON_END ? through : SEASON_END;

  if (to < SEASON_START) {
    console.log(`The ${SEASON - 1}-${String(SEASON).slice(2)} season starts ${SEASON_START}. Nothing to import yet.`);
    return;
  }

  // --resume picks up after the last imported day; --from only applies
  // on the very first run. --to stops at `to` so no call is spent on a
  // day that hasn't been played. If the last run already reached `to`,
  // fetch that day again instead: it may have been imported mid-evening.
  // Plays already loaded are skipped, so this costs one call, nothing more.
  const { data: checkpoint } = await db
    .from("ingest_checkpoints")
    .select("cursor")
    .eq("job", `shots:${SEASON}`)
    .maybeSingle();
  const range =
    checkpoint?.cursor && checkpoint.cursor >= to
      ? ["--from", to, "--to", to]
      : ["--resume", "--from", SEASON_START, "--to", to];
  const before = await seasonShots();
  const run = spawnSync(
    "npx",
    ["tsx", "--env-file=.env.local", "scripts/ingest-shots.ts", "--season", String(SEASON), ...range],
    { stdio: "inherit" },
  );
  if (run.status !== 0) {
    console.error("Import stopped early; fix the error above and run again. Nothing was refreshed.");
    process.exit(run.status ?? 1);
  }

  const after = await seasonShots();
  const changed = before === null || after !== before;
  // For the daily job: a later step refreshes only if something changed.
  if (changed && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "changed=true\n");

  if (process.argv.includes("--no-refresh")) {
    console.log(changed ? "\nNew shots imported; summaries not refreshed yet." : "\nNo new shots since the last run.");
    return;
  }
  // Hourly runs mostly find nothing new; the refresh is the slow part
  // (a couple of minutes), so it's skipped when no shot was added. The
  // morning run always refreshes, in case an earlier one was cut short.
  if (process.argv.includes("--today") && !changed) {
    console.log("\nNo new shots since the last run; charts are already current.");
    return;
  }
  await refresh();
}

async function refresh() {
  await settleNames();
  console.log("\nRefreshing shot-chart summaries...");
  const { data, error } = await db.rpc("refresh_shot_views");
  // Supabase's API gateway gives up on a request after about two minutes,
  // and with more than one season loaded the refresh takes longer. The
  // database finishes it regardless, so a gateway timeout isn't a failure.
  if (error && /upstream request timeout/i.test(error.message)) {
    console.log("Refresh is still running in the database (it outlasts the API's 2-minute limit); it finishes on its own.");
    return;
  }
  if (error) {
    console.error(
      `Refresh failed: ${error.message}\n` +
        "If it says the function doesn't exist, run supabase/refresh-shot-views.sql once in the Supabase SQL editor.",
    );
    process.exit(1);
  }
  console.log(data);
}

/**
 * One spelling per player before the refresh.
 *
 * The play-by-play sometimes spells a player two ways ("Mike Walz", then
 * "Michael Walz"). The player summaries are keyed by player and zone, so
 * a second spelling makes a duplicate row and the whole refresh fails and
 * rolls back: in November 2026 three such players froze every shot chart
 * for six days. Shots still waiting for a zone are the ones the summaries
 * haven't seen; any of them that names a player differently from the
 * summaries (or from each other) is rewritten to the established name.
 */
async function settleNames() {
  // Names on the shots imported since the last good refresh.
  const fresh = new Map<number, Map<string, number>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("shot_events")
      .select("player_id,player_name")
      .eq("season", SEASON)
      .is("zone", null)
      .not("x", "is", null)
      .not("player_id", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`Reading new shots: ${error.message}`);
    for (const s of data ?? []) {
      if (!s.player_name) continue;
      const names = fresh.get(s.player_id) ?? new Map<string, number>();
      names.set(s.player_name, (names.get(s.player_name) ?? 0) + 1);
      fresh.set(s.player_id, names);
    }
    if ((data ?? []).length < 1000) break;
  }
  if (!fresh.size) return;

  // Names the summaries already have for those players.
  const known = new Map<number, Map<string, number>>();
  const ids = [...fresh.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("player_zone_stats")
        .select("player_id,player_name,attempts")
        .eq("season", SEASON)
        .in("player_id", ids.slice(i, i + 200))
        .order("player_id")
        .order("zone")
        .range(from, from + 999);
      if (error) throw new Error(`Reading player summaries: ${error.message}`);
      for (const r of data ?? []) {
        const names = known.get(r.player_id) ?? new Map<string, number>();
        names.set(r.player_name, (names.get(r.player_name) ?? 0) + r.attempts);
        known.set(r.player_id, names);
      }
      if ((data ?? []).length < 1000) break;
    }
  }

  const most = (names: Map<string, number>) => [...names].sort((a, b) => b[1] - a[1])[0][0];
  for (const [id, names] of fresh) {
    const before = known.get(id);
    const all = new Set([...names.keys(), ...(before?.keys() ?? [])]);
    if (all.size < 2) continue;
    // The name already on the charts wins; a new player's most-used one.
    const keep = before ? most(before) : most(names);
    const { error } = await db
      .from("shot_events")
      .update({ player_name: keep })
      .eq("season", SEASON)
      .eq("player_id", id)
      .neq("player_name", keep);
    if (error) throw new Error(`Renaming player ${id}: ${error.message}`);
    console.log(`One spelling for player ${id}: "${keep}" (also seen: ${[...all].filter((n) => n !== keep).join(", ")}).`);
  }
}

/** Shots stored for the live season, or null if the count failed. */
async function seasonShots() {
  const { count, error } = await db
    .from("shot_events")
    .select("id", { count: "exact", head: true })
    .eq("season", SEASON);
  return error ? null : count;
}

/** YYYY-MM-DD in US Eastern time, offset by `days`. */
function easternDate(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
