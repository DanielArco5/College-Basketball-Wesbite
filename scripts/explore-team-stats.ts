/**
 * One exploratory call to see what CBBD's team season stats actually
 * contain. Writes the raw response to a file and prints the field names
 * of the first record.
 *
 * Costs ONE API call against the 1,000/month budget. Run it once.
 *
 *   npx tsx scripts/explore-team-stats.ts
 *
 * The endpoint path is a guess. If it 404s, the script prints the
 * status and you check the docs at api.collegebasketballdata.com for
 * the right path — it's the basketball host, not the football one.
 */

import { writeFileSync } from "node:fs";

const KEY = process.env.CBBD_API_KEY;
if (!KEY) {
  console.error("CBBD_API_KEY missing from the environment.");
  process.exit(1);
}

const BASE = "https://api.collegebasketballdata.com";
const SEASON = 2026;

// Candidates, tried in order until one returns data. Each miss is a
// wasted call, so the list is short and ordered by likelihood.
const PATHS = [
  `/stats/team/season?season=${SEASON}`,
  `/stats/team?season=${SEASON}`,
];

async function main() {
  for (const path of PATHS) {
    const url = `${BASE}${path}`;
    console.log(`\nTrying ${url}`);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${KEY}` },
    });

    console.log(`  status ${res.status}`);
    if (!res.ok) {
      console.log(`  ${(await res.text()).slice(0, 200)}`);
      continue;
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      console.log("  returned no records");
      continue;
    }

    const out = "scripts/team-stats-sample.json";
    writeFileSync(out, JSON.stringify(data.slice(0, 3), null, 2));

    console.log(`\n  ${data.length} records. Sample written to ${out}`);
    console.log("\n  Top-level fields:");
    for (const k of Object.keys(data[0])) {
      const v = (data[0] as Record<string, unknown>)[k];
      const kind =
        v === null
          ? "null"
          : typeof v === "object"
          ? `object{${Object.keys(v as object).join(", ")}}`
          : typeof v;
      console.log(`    ${k}: ${kind}`);
    }

    console.log(
      "\n  What matters: field goal attempts, free throw attempts,\n" +
        "  offensive rebounds, turnovers, points — and whether the same\n" +
        "  figures exist for OPPONENTS. If opponent stats are there, the\n" +
        "  defensive rating comes free. If not, it has to be derived from\n" +
        "  the schedule."
    );
    return;
  }

  console.error("\nNo path worked. Check the endpoint list in the docs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
