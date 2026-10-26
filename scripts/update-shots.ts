/**
 * Keep the live season's shot charts current.
 *
 *   npm run update-shots
 *
 * Imports every game day since the last run, up to and including
 * yesterday (Eastern), then refreshes the shot-chart summaries. Safe to
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
/** First day of the 2026-27 regular season. */
const SEASON_START = "2026-11-02";
/** Last day plays can exist: through the national championship. */
const SEASON_END = "2027-04-12";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function main() {
  const yesterday = easternDate(-1);
  const to = yesterday < SEASON_END ? yesterday : SEASON_END;

  if (to < SEASON_START) {
    console.log(`The ${SEASON - 1}-${String(SEASON).slice(2)} season starts ${SEASON_START}. Nothing to import yet.`);
    return;
  }

  // --resume picks up after the last imported day; --from only applies
  // on the very first run. --to stops at yesterday so no call is spent
  // on a day that hasn't been played.
  const run = spawnSync(
    "npx",
    [
      "tsx", "--env-file=.env.local", "scripts/ingest-shots.ts",
      "--season", String(SEASON), "--resume", "--from", SEASON_START, "--to", to,
    ],
    { stdio: "inherit" },
  );
  if (run.status !== 0) {
    console.error("Import stopped early; fix the error above and run again. Nothing was refreshed.");
    process.exit(run.status ?? 1);
  }

  console.log("\nRefreshing shot-chart summaries...");
  const { data, error } = await db.rpc("refresh_shot_views");
  if (error) {
    console.error(
      `Refresh failed: ${error.message}\n` +
        "If it says the function doesn't exist, run supabase/refresh-shot-views.sql once in the Supabase SQL editor.",
    );
    process.exit(1);
  }
  console.log(data);
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
