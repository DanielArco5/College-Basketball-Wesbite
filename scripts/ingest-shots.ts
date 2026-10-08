/**
 * CBBD shot ingestion.
 *
 *   npx tsx scripts/ingest-shots.ts --season 2026 --from 2025-11-03 --to 2026-04-06
 *   npx tsx scripts/ingest-shots.ts --season 2026 --resume
 *   npx tsx scripts/ingest-shots.ts --date 2026-01-15
 *   npx tsx scripts/ingest-shots.ts --season 2026 --untracked [--resume]
 *
 * --untracked backfills only the field goals that have no court location,
 * which ingests before supabase/untracked-shots.sql dropped. It never
 * touches rows already loaded and skips the raw archive, since those
 * payloads were archived the first time.
 *
 * Env:
 *   CBBD_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   <- service role, not anon. This writes.
 *
 * Why by-date and not by-team:
 *   /plays/team returns every play from that team's games, including the
 *   opponent's. Looping 364 teams fetches each game twice and burns ~364 of
 *   your 1,000 monthly calls. A season is ~150 game days, so by-date is
 *   cheaper AND has no duplicates. The unique index on source_play_id makes
 *   reruns safe either way.
 */

import { createClient } from "@supabase/supabase-js";

const CBBD_BASE = "https://api.collegebasketballdata.com";
const API_KEY = requireEnv("CBBD_API_KEY");

const db = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

// ---------------------------------------------------------------------------
// Court geometry
// ---------------------------------------------------------------------------

const COURT_LENGTH_FT = 94;
const COURT_WIDTH_FT = 50;
const HALF_COURT_FT = COURT_LENGTH_FT / 2; // 47
const BASKET_X_FT = 5.25; // center of hoop, measured from the baseline
const BASKET_Y_FT = COURT_WIDTH_FT / 2; // 25

/**
 * CBBD ships full-court coordinates at 10 units per foot, where x is the
 * LONG axis. Shots at the far basket (x > 47) get mirrored onto the near
 * half so every shot chart is a single half court.
 *
 * Mirroring y as well as x is not optional — the court has 180-degree
 * rotational symmetry, not mirror symmetry. Flip only x and every left-corner
 * three from the far end lands in the right corner.
 */
export function toHalfCourt(rawXUnits: number, rawYUnits: number) {
  const rawX = rawXUnits / 10;
  const rawY = rawYUnits / 10;

  const farSide = rawX > HALF_COURT_FT;
  const x = farSide ? COURT_LENGTH_FT - rawX : rawX;
  const y = farSide ? COURT_WIDTH_FT - rawY : rawY;

  const distFt = Math.hypot(x - BASKET_X_FT, y - BASKET_Y_FT);

  return {
    rawX: round2(rawX),
    rawY: round2(rawY),
    x: round2(x),
    y: round2(y),
    distFt: round2(distFt),
  };
}

/** Reject coordinates that fall outside the court or sit at a null-ish origin. */
function plausible(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < 0 || x > HALF_COURT_FT + 0.5) return false;
  if (y < 0 || y > COURT_WIDTH_FT) return false;
  // (0,0) is CBBD's "we didn't track it" tell, not a shot from the corner of
  // the baseline. Drop it or your corner-three bucket is poisoned.
  if (x === 0 && y === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// CBBD client
// ---------------------------------------------------------------------------

type Play = {
  id?: number;
  sourceId?: string;
  gameId: number;
  gameSourceId?: string;
  gameStartDate?: string;
  season: number;
  seasonType?: string;
  gameType?: string;
  isHomeTeam?: boolean;
  teamId?: number;
  team?: string;
  conference?: string;
  opponentId?: number;
  opponent?: string;
  opponentConference?: string;
  period?: number;
  clock?: string;
  secondsRemaining?: number;
  playType?: string;
  shootingPlay?: boolean;
  scoreValue?: number;
  shotInfo?: {
    shooter?: { id?: number; name?: string };
    made?: boolean;
    range?: string;
    assisted?: boolean;
    assistedBy?: { id?: number; name?: string };
    location?: { x?: number; y?: number };
  };
};

async function cbbd<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${CBBD_BASE}${path}?${new URLSearchParams(params)}`;
  const started = Date.now();
  let lastErr: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: "application/json",
        },
      });

      await logCall(path, params, res.status, Date.now() - started);

      if (res.status === 429) {
        // Respect Retry-After when present; CBBD sends remaining-quota headers too.
        const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || backoff(attempt);
        console.warn(`  429 on ${path}, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }

      if (res.status >= 500) {
        await sleep(backoff(attempt));
        continue;
      }

      if (!res.ok) {
        throw new Error(`CBBD ${res.status} ${path}: ${await res.text()}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      await sleep(backoff(attempt));
    }
  }

  throw new Error(`CBBD failed after retries: ${path} — ${String(lastErr)}`);
}

async function logCall(endpoint: string, params: object, status: number, ms: number) {
  const { error } = await db.from("api_calls").insert({ endpoint, params, status, ms });
  if (error) console.warn(`  quota log failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Ingest one date
// ---------------------------------------------------------------------------

// CBBD's labels for a field goal. A play with no location and no label
// can't be told apart from a free throw, so it isn't kept.
const FIELD_GOAL_RANGES = new Set(["rim", "jumper", "three_pointer"]);

async function ingestDate(dateISO: string, season: number, untrackedOnly = false) {
  // NOTE: verify this param name against the live docs before your first real
  // backfill — the wrappers expose it as shooting_plays_only. The filter below
  // makes the result correct either way, it just costs a bigger payload.
  const params = {
    date: `${dateISO}T00:00:00.000Z`,
    season: String(season),
    shootingPlaysOnly: "true",
  };

  const plays = await cbbd<Play[]>("/plays/date", params);

  if (!plays?.length) {
    console.log(`${dateISO}: no plays`);
    return { shots: 0, games: 0 };
  }

  // Archive raw before touching anything else. This is the failover.
  if (!untrackedOnly) {
    await db.from("ingest_raw").insert({
      endpoint: "/plays/date",
      params,
      row_count: plays.length,
      payload: plays,
    });
  }

  const teams = new Map<number, Record<string, unknown>>();
  const players = new Map<number, Record<string, unknown>>();
  const games = new Map<number, Record<string, unknown>>();
  const shots: Record<string, unknown>[] = [];

  let dropped = 0;
  let untracked = 0;

  for (const p of plays) {
    if (p.shootingPlay === false) continue;

    const info = p.shotInfo;
    if (!info) {
      dropped++;
      continue;
    }

    // Field goals without a usable location are still field goals: they
    // count in season totals with x, y and zone left null. Some games have
    // no location tracking at all, and dropping these lost them entirely.
    const loc = info.location;
    const geo = loc?.x != null && loc?.y != null ? toHalfCourt(loc.x, loc.y) : null;
    const located = geo !== null && plausible(geo.x, geo.y);

    if (!located && !FIELD_GOAL_RANGES.has(info.range ?? "")) {
      dropped++;
      continue;
    }
    if (located && untrackedOnly) continue;
    if (!located) untracked++;

    // Stub rows so the FKs resolve. Enrich later from /teams and /roster.
    if (p.teamId) {
      teams.set(p.teamId, { id: p.teamId, school: p.team ?? String(p.teamId), conference: p.conference });
    }
    if (p.opponentId) {
      teams.set(p.opponentId, {
        id: p.opponentId,
        school: p.opponent ?? String(p.opponentId),
        conference: p.opponentConference,
      });
    }

    const shooterId = info.shooter?.id ?? null;
    if (shooterId) {
      players.set(shooterId, { id: shooterId, name: info.shooter?.name ?? "Unknown" });
    }

    if (!games.has(p.gameId)) {
      const homeId = p.isHomeTeam ? p.teamId : p.opponentId;
      const awayId = p.isHomeTeam ? p.opponentId : p.teamId;
      games.set(p.gameId, {
        id: p.gameId,
        source_id: p.gameSourceId ?? null,
        season: p.season,
        season_type: p.seasonType ?? null,
        game_type: p.gameType ?? null,
        start_date: p.gameStartDate ?? null,
        home_team_id: homeId ?? null,
        away_team_id: awayId ?? null,
        shots_ingested: true,
        ingested_at: new Date().toISOString(),
      });
    }

    shots.push({
      source_play_id: p.sourceId ?? `${p.gameId}-${p.id}`,
      play_id: p.id ?? null,
      game_id: p.gameId,
      season: p.season,
      season_type: p.seasonType ?? null,
      team_id: p.teamId ?? null,
      opponent_id: p.opponentId ?? null,
      is_home: p.isHomeTeam ?? null,
      player_id: shooterId,
      player_name: info.shooter?.name ?? null,
      period: p.period ?? null,
      clock: p.clock ?? null,
      seconds_remaining: p.secondsRemaining ?? null,
      play_type: p.playType ?? null,
      made: info.made === true,
      score_value: p.scoreValue ?? null,
      assisted: info.assisted ?? false,
      assisted_by_id: info.assistedBy?.id ?? null,
      cbbd_range: info.range ?? null,
      raw_x: geo?.rawX ?? null,
      raw_y: geo?.rawY ?? null,
      x: located ? geo.x : null,
      y: located ? geo.y : null,
      dist_ft: located ? geo.distFt : null,
    });
  }

  // Order matters: parents before children. A backfill only fills gaps:
  // stub rows must not overwrite teams and players enriched since.
  const insertOnly = untrackedOnly;
  await upsertChunked("teams", [...teams.values()], "id", insertOnly);
  await upsertChunked("players", [...players.values()], "id", insertOnly);
  await upsertChunked("games", [...games.values()], "id", insertOnly);
  await upsertChunked("shot_events", shots, "source_play_id");

  console.log(
    `${dateISO}: ${shots.length} shots across ${games.size} games` +
      (untracked ? ` (${untracked} untracked)` : "") +
      (dropped ? ` (${dropped} dropped, not a field goal)` : "")
  );

  return { shots: shots.length, games: games.size };
}

async function upsertChunked(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  ignoreDuplicates = false,
) {
  const SIZE = 500;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE);

    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await db.from(table).upsert(chunk, { onConflict, ignoreDuplicates });
      if (!error) {
        lastErr = undefined;
        break;
      }
      lastErr = error;
      // Cloudflare edge blips in front of Supabase surface as non-JSON 5xx
      // bodies (521/522), not Postgres errors — those are worth a retry.
      console.warn(`  upsert ${table} attempt ${attempt + 1} failed, retrying: ${String(error.message).slice(0, 120)}`);
      await sleep(backoff(attempt));
    }
    if (lastErr) throw new Error(`upsert ${table}: ${(lastErr as { message: string }).message}`);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const season = Number(args.season ?? new Date().getFullYear());
  const untrackedOnly = args.untracked === true;
  const job = `${untrackedOnly ? "untracked" : "shots"}:${season}`;

  let dates: string[];

  if (args.date) {
    dates = [args.date];
  } else {
    let from = args.from ?? `${season - 1}-11-01`;
    const to = args.to ?? `${season}-04-10`;

    if (args.resume) {
      const { data } = await db.from("ingest_checkpoints").select("cursor").eq("job", job).single();
      if (data?.cursor) {
        from = nextDay(data.cursor);
        console.log(`Resuming from ${from}`);
      }
    }
    dates = dateRange(from, to);
  }

  console.log(`Ingesting ${dates.length} date(s) for season ${season}\n`);

  let totalShots = 0;
  for (const d of dates) {
    try {
      const { shots } = await ingestDate(d, season, untrackedOnly);
      totalShots += shots;
      await db.from("ingest_checkpoints").upsert({ job, cursor: d, updated_at: new Date().toISOString() });
    } catch (err) {
      // Stop rather than silently skipping days — a gap in the backfill
      // corrupts the D1 baseline you're about to compute from it.
      console.error(`FAILED on ${d}:`, err);
      console.error(`Fix, then rerun with --resume.`);
      process.exit(1);
    }
    await sleep(3000); // pace for the free-tier database, not just CBBD
  }

  // Season totals are materialized; new shots don't show until refreshed.
  const { error: refreshErr } = await db.rpc("refresh_season_totals");
  if (refreshErr) console.warn(`Totals refresh failed: ${refreshErr.message}`);

  const { data: usage } = await db.from("api_usage_this_month").select("calls").single();
  console.log(`\nDone. ${totalShots} shots. API calls this month: ${usage?.calls ?? "?"} / 1000`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else out[key] = next, i++;
  }
  return out as Record<string, any>;
}

function dateRange(from: string, to: string) {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
