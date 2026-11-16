/**
 * Is the once-a-day work due? (Box scores, player stats, and a second
 * look at yesterday's late games.)
 *
 *   npx tsx --env-file=.env.local scripts/due.ts            # prints morning=true|false
 *   npx tsx --env-file=.env.local scripts/due.ts --force    # always true
 *   npx tsx --env-file=.env.local scripts/due.ts --done     # record that today's is finished
 *
 * The daily job used to leave this work to one scheduled run each
 * morning. GitHub starts scheduled runs hours late and skips many, and
 * when that one run failed, nothing tried again until the next day. Now
 * every run asks here, and the first one after 3 a.m. Eastern (when the
 * last West Coast and Hawai'i games are over) does the work. It's marked
 * done only once it succeeds, so a failed run is retried by the next.
 *
 * Remembered in ingest_checkpoints, job daily:morning. On GitHub the
 * answer also goes to the step's outputs.
 */

import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const JOB = "daily:morning";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

async function main() {
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  if (process.argv.includes("--done")) {
    const { error } = await db
      .from("ingest_checkpoints")
      .upsert({ job: JOB, cursor: today, updated_at: now.toISOString() }, { onConflict: "job" });
    if (error) throw new Error(error.message);
    console.log(`Daily work recorded as done for ${today}.`);
    return;
  }

  let due = true;
  let why = "run by hand";
  if (!process.argv.includes("--force")) {
    const hour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
    const { data, error } = await db.from("ingest_checkpoints").select("cursor").eq("job", JOB).maybeSingle();
    if (error) {
      // Can't tell; doing it twice costs two API calls, skipping it costs a day.
      why = `couldn't read the checkpoint (${error.message})`;
    } else if (data?.cursor === today) {
      due = false;
      why = `already done for ${today}`;
    } else if (hour < 3) {
      due = false;
      why = "last night's games may still be going; after 3 a.m. Eastern";
    } else {
      why = `not yet done for ${today}`;
    }
  }

  console.log(`morning=${due} (${why})`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `morning=${due}\n`);
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
