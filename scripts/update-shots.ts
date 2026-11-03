/**
 * Keep the live season's shot charts current.
 *
 *   npm run update-shots              # through yesterday (Eastern)
 *   npm run update-shots -- --today   # through today, games finished so far
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
 * Needs supabase/refresh-shot-views.sql run once in the SQL editor.
 */

import { spawnSync } from "node:child_process";
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

  // Hourly runs mostly find nothing new; the refresh is the slow part
  // (a couple of minutes), so it's skipped when no shot was added. The
  // morning run always refreshes, in case an earlier one was cut short.
  const after = await seasonShots();
  if (process.argv.includes("--today") && before !== null && after === before) {
    console.log("\nNo new shots since the last run; charts are already current.");
    return;
  }

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
