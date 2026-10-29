/**
 * Final AP Top 25 for finished seasons, into lib/ap-final.json.
 *
 *   npx tsx --env-file=.env.local scripts/ap-final.ts
 *
 * Reads ESPN's public rankings feed (no key, no CBBD calls) and matches
 * each team to ours by ESPN id. A finished season's poll never changes,
 * so this runs once per season: add the season to SEASONS after its final
 * poll is out. The live season's poll is read on the fly by lib/ap.ts.
 */

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SEASONS = [2025, 2026];
const FEED = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings";

type EspnRank = {
  current: number;
  points?: number;
  recordSummary?: string;
  team: { id: string; location: string };
};
type EspnRankings = {
  weeks: { display: string; week: string; type: string }[];
  rankings: { type: string; headline: string; date?: string; ranks: EspnRank[] }[];
};

async function main() {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const { data: teams, error } = await db.from("teams").select("id, school, source_id").range(0, 1999);
  if (error) throw new Error(error.message);
  const byEspn = new Map((teams ?? []).map((t) => [String(t.source_id), t]));
  const bySchool = new Map((teams ?? []).map((t) => [t.school, t]));

  const out: Record<number, unknown> = {};
  for (const season of SEASONS) {
    const list = (await (await fetch(`${FEED}?seasons=${season}`)).json()) as EspnRankings;
    const final = list.weeks.find((w) => w.display === "Final Rankings");
    if (!final) throw new Error(`${season}: no final poll yet`);
    const poll = (await (
      await fetch(`${FEED}?seasons=${season}&types=${final.type}&weeks=${final.week}`)
    ).json()) as EspnRankings;
    const ap = poll.rankings.find((r) => r.type === "ap");
    if (!ap) throw new Error(`${season}: no AP poll in the final week`);

    const rows = ap.ranks.map((r) => {
      const t = byEspn.get(r.team.id) ?? bySchool.get(r.team.location);
      return {
        rank: r.current,
        school: t?.school ?? r.team.location,
        team_id: t?.id ?? null,
        record: r.recordSummary ?? null,
      };
    });
    out[season] = { date: ap.date ?? null, rows };
    const missing = rows.filter((r) => !r.team_id).map((r) => r.school);
    console.log(
      `${season}: ${rows.slice(0, 3).map((r) => `${r.rank}. ${r.school}`).join(", ")}...` +
        (missing.length ? ` (unmatched: ${missing.join(", ")})` : ""),
    );
  }
  writeFileSync("lib/ap-final.json", JSON.stringify(out, null, 1) + "\n");
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
