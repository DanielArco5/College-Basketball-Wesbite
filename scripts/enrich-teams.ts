/**
 * CBBD team enrichment.
 *
 *   npm run enrich-teams
 *
 * The shot ingest creates teams as minimal stubs — id and school only — because
 * foreign keys need the parent row to exist before shots can reference it. This
 * fills in everything else: conference, colors, logos, and the is_d1 flag.
 *
 * Run it once after a backfill, and again at the start of each season.
 *
 * Costs two API calls total.
 *
 * Why two seasons: the table contains every team that appeared in any game,
 * including schools that show up in one season's /teams response and not the
 * other. Taking the union avoids demoting a real D1 program over a gap in a
 * single season's data.
 *
 * Why is_d1 gets cleared first: the column defaults to true, so every stub row
 * inherited it and the flag currently means nothing. Clearing it makes the
 * value derived from what CBBD actually returns.
 */

import { createClient } from "@supabase/supabase-js";

const CBBD_BASE = "https://api.collegebasketballdata.com";
const API_KEY = requireEnv("CBBD_API_KEY");

const SEASONS = [2026, 2025];

const db = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

type Team = {
  id: number;
  sourceId?: string;
  school?: string;
  mascot?: string;
  abbreviation?: string;
  displayName?: string;
  shortDisplayName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  currentVenueId?: number;
  conference?: string;
  conferenceId?: number;
  logo?: string;
  logos?: string[];
};

// ---------------------------------------------------------------------------
// CBBD client — same retry/backoff and quota logging as the ingest script
// ---------------------------------------------------------------------------

async function cbbd<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `${CBBD_BASE}${path}?${new URLSearchParams(params)}`;
  const started = Date.now();
  let lastErr: unknown;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" },
      });

      await logCall(path, params, res.status, Date.now() - started);

      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || backoff(attempt);
        console.warn(`  429, waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500) {
        await sleep(backoff(attempt));
        continue;
      }
      if (!res.ok) throw new Error(`CBBD ${res.status} ${path}: ${await res.text()}`);

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
// Color handling
// ---------------------------------------------------------------------------

/**
 * CBBD returns colors with inconsistent formatting — sometimes with a leading
 * '#', sometimes bare hex, occasionally empty or whitespace. Normalize to
 * '#RRGGBB' or null so the team_colors view can rely on the shape.
 */
function normalizeHex(raw?: string): string | null {
  if (!raw) return null;
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Clear the flag so it ends up derived from the API, not from the default.
  console.log("Clearing is_d1 across all teams...");
  const { error: clearErr, count: cleared } = await db
    .from("teams")
    .update({ is_d1: false }, { count: "exact" })
    .neq("id", -1); // matches every row; Supabase requires a filter on update
  if (clearErr) throw new Error(`clear is_d1: ${clearErr.message}`);
  console.log(`  cleared ${cleared ?? "?"} rows\n`);

  // 2. Union the seasons. Later seasons win on conflict, so walk newest first
  //    and skip ids already seen — current conference affiliation beats stale.
  const merged = new Map<number, Team>();

  for (const season of SEASONS) {
    const params = { season: String(season) };
    const teams = await cbbd<Team[]>("/teams", params);
    console.log(`${season}: ${teams.length} teams from CBBD`);

    await db.from("ingest_raw").insert({
      endpoint: "/teams",
      params,
      row_count: teams.length,
      payload: teams,
    });

    let added = 0;
    for (const t of teams) {
      if (!t.id || merged.has(t.id)) continue;
      merged.set(t.id, t);
      added++;
    }
    console.log(`  ${added} new to the union\n`);
    await sleep(1200);
  }

  // 3. Upsert. Only columns CBBD owns — color_override stays untouched so any
  //    manual dark-theme fixes survive a rerun.
  const rows = [...merged.values()].map((t) => ({
    id: t.id,
    source_id: t.sourceId ?? null,
    school: t.school ?? String(t.id),
    mascot: t.mascot ?? null,
    abbreviation: t.abbreviation ?? null,
    short_display: t.shortDisplayName ?? t.displayName ?? null,
    conference: t.conference ?? null,
    primary_color: normalizeHex(t.primaryColor),
    alt_color: normalizeHex(t.secondaryColor),
    logo_url: t.logo ?? t.logos?.[0] ?? null,
    is_d1: true,
    updated_at: new Date().toISOString(),
  }));

  console.log(`Upserting ${rows.length} teams...`);
  const SIZE = 500;
  for (let i = 0; i < rows.length; i += SIZE) {
    const { error } = await db
      .from("teams")
      .upsert(rows.slice(i, i + SIZE), { onConflict: "id" });
    if (error) throw new Error(`upsert teams: ${error.message}`);
  }

  // 4. Report.
  const { count: d1 } = await db
    .from("teams")
    .select("*", { count: "exact", head: true })
    .eq("is_d1", true);
  const { count: nonD1 } = await db
    .from("teams")
    .select("*", { count: "exact", head: true })
    .eq("is_d1", false);
  const { count: noColor } = await db
    .from("teams")
    .select("*", { count: "exact", head: true })
    .eq("is_d1", true)
    .is("primary_color", null);

  console.log(`\nD1: ${d1}   non-D1: ${nonD1}   D1 missing color: ${noColor}`);

  if (noColor && noColor > 0) {
    const { data } = await db
      .from("teams")
      .select("school")
      .eq("is_d1", true)
      .is("primary_color", null)
      .limit(10);
    console.log(`  e.g. ${data?.map((d) => d.school).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
