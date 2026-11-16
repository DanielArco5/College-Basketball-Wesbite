/**
 * Posts for the site's X (Twitter) account.
 *
 *   npm run tweet -- shooters                 # preview yesterday's hot and cold shooters
 *   npm run tweet -- shooters --date 2026-11-14
 *   npm run tweet -- chart                    # preview the next unusual team shot chart
 *   npm run tweet -- chart --team "Alabama"
 *   npm run tweet -- auto --post              # what the scheduled job runs
 *
 * Without --post nothing is sent: the image and the text are written to
 * out/tweets/ to look at. With --post it goes out, and needs the four X_
 * values described in scripts/tweet/x.ts.
 *
 * `auto` posts whatever is due and nothing twice:
 *   shooters  once a day, for yesterday, from 6 a.m. Eastern, once the
 *             day's full import (scripts/due.ts) is done
 *   chart     every third day, from noon Eastern, a team not shown in
 *             the last 30 charts
 * What's been posted is remembered in ingest_checkpoints (jobs
 * tweet:shooters and tweet:chart). Read-only otherwise, and no
 * CollegeBasketballData calls.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { toPng } from "./tweet/render";
import { easternDay, shootersPost } from "./tweet/shooters";
import { teamChartPost } from "./tweet/team-chart";
import { postWithImage, xCredentials, xLength } from "./tweet/x";

const SEASON = 2027;
/** Days between team shot charts. */
const CHART_EVERY_DAYS = 3;
/** A team isn't charted again until this many other charts have run. */
const CHART_NO_REPEAT = 30;

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const POST = flag("--post");

type ChartLog = { day: string; teams: number[] };

async function main() {
  const kind = args[0];
  if (kind === "shooters") await shooters(option("--date") ?? easternDay(daysAgo(1)), false);
  else if (kind === "chart") await chart(false);
  else if (kind === "auto") await auto();
  else {
    console.error("Usage: npm run tweet -- shooters|chart|auto [--date YYYY-MM-DD] [--team NAME] [--post]");
    process.exit(1);
  }
}

/** Post what's due. One failing doesn't stop the other. */
async function auto() {
  const hour = Number(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
  );
  // Until the X account is connected the scheduled job has nothing to
  // do; that's not a failure.
  const creds = xCredentials();
  if (POST && "missing" in creds) {
    return console.log(`X isn't set up (${creds.missing.join(", ")} not set); nothing posted.`);
  }
  let failed = false;
  const attempt = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      failed = true;
      console.error(`${name}: ${err instanceof Error ? err.message : err}`);
    }
  };

  await attempt("shooters", async () => {
    const day = easternDay(daysAgo(1));
    const posted = await checkpoint("tweet:shooters");
    if (posted && posted >= day) return console.log(`shooters: ${day} already posted.`);
    if (hour < 6) return console.log("shooters: waiting until 6 a.m. Eastern.");
    // The once-a-day work (scripts/due.ts) re-imports yesterday after the
    // late games (West Coast, Hawai'i) are over. Before it, the list
    // could be missing a third of the night.
    if ((await checkpoint("daily:morning")) !== easternDay(new Date())) {
      return console.log("shooters: last night's games aren't all imported yet; next run.");
    }
    await shooters(day, true);
  });

  await attempt("chart", async () => {
    const log = await chartLog();
    const today = easternDay(new Date());
    const next = log.day ? addDays(log.day, CHART_EVERY_DAYS) : today;
    if (today < next) return console.log(`chart: next one is due ${next}.`);
    if (hour < 12) return console.log("chart: waiting until noon Eastern.");
    await chart(true);
  });

  if (failed) process.exit(1);
}

async function shooters(day: string, record: boolean) {
  const post = await shootersPost(db, SEASON, day);
  if ("skip" in post) {
    console.log(`shooters: nothing to post, ${post.skip}.`);
    // A day off is settled, not retried every hour.
    if (record && POST) await setCheckpoint("tweet:shooters", day);
    return;
  }
  console.log(post.summary);
  const sent = await send(`shooters-${day}`, post.text, post.svg);
  if (sent && record) await setCheckpoint("tweet:shooters", day);
}

async function chart(record: boolean) {
  const log = await chartLog();
  const post = await teamChartPost(db, SEASON, { skipTeams: log.teams, team: option("--team") });
  if ("skip" in post) return console.log(`chart: nothing to post, ${post.skip}.`);
  console.log(post.summary);
  const sent = await send(`chart-${post.slug}`, post.text, post.svg);
  if (sent && record) {
    const teams = [post.teamId, ...log.teams.filter((id) => id !== post.teamId)].slice(0, CHART_NO_REPEAT);
    await setCheckpoint("tweet:chart", JSON.stringify({ day: easternDay(new Date()), teams } satisfies ChartLog));
  }
}

/**
 * Post it, or with no --post write it to out/tweets/. True only when it
 * actually went out.
 */
async function send(name: string, text: string, svg: string) {
  const length = xLength(text);
  if (length > 280) throw new Error(`Post is ${length} characters; X allows 280:\n${text}`);
  const png = toPng(svg);

  if (!POST) {
    const dir = join(process.cwd(), "out", "tweets");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.png`), png);
    writeFileSync(join(dir, `${name}.txt`), text + "\n");
    console.log(`\n${text}\n\n(${length}/280) Preview only, nothing posted. Image: out/tweets/${name}.png`);
    return false;
  }

  const creds = xCredentials();
  if ("missing" in creds) {
    throw new Error(`Can't post: ${creds.missing.join(", ")} not set. See scripts/tweet/x.ts.`);
  }
  const id = await postWithImage(creds, text, png);
  console.log(`\n${text}\n\nPosted: https://x.com/i/status/${id}`);
  return true;
}

// ── What's been posted (ingest_checkpoints) ────────────────────────────

async function checkpointRow(job: string) {
  const { data, error } = await db
    .from("ingest_checkpoints")
    .select("cursor,updated_at")
    .eq("job", job)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { cursor: string | null; updated_at: string } | null;
}

async function checkpoint(job: string) {
  return (await checkpointRow(job))?.cursor ?? null;
}

async function setCheckpoint(job: string, cursor: string) {
  const { error } = await db
    .from("ingest_checkpoints")
    .upsert({ job, cursor, updated_at: new Date().toISOString() }, { onConflict: "job" });
  // The post is already out; say so loudly, since the next run will repeat it.
  if (error) throw new Error(`Posted, but couldn't record it (${error.message}). The next run may post it again.`);
}

async function chartLog(): Promise<ChartLog> {
  const raw = await checkpoint("tweet:chart");
  if (!raw) return { day: "", teams: [] };
  try {
    const log = JSON.parse(raw) as Partial<ChartLog>;
    return { day: log.day ?? "", teams: log.teams ?? [] };
  } catch {
    return { day: "", teams: [] };
  }
}

// ── Dates ──────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86_400_000);
}

function addDays(day: string, n: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
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
