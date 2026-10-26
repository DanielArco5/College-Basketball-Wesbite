/**
 * Team season totals from NCAA.com's official stats pages. No API calls.
 *
 *   npx tsx --env-file=.env.local scripts/ncaa-stats.ts            # 2026-27
 *   npx tsx --env-file=.env.local scripts/ncaa-stats.ts --year 2026  # 2025-26
 *
 * NCAA.com names a season by the year it ends, so 2027 is 2026-27.
 * Reads ten national stat tables (about 80 pages), three seconds apart,
 * and writes scripts/.cache/ncaa-team-<year>.json: one row of raw totals
 * per D1 team, keyed by our teams.id. scripts/project-2027.ts blends
 * these into the ranking once games have been played.
 *
 * Pages are cached under scripts/.cache/ncaa/<year>/<date>/, so a re-run
 * on the same day reads from disk. A new day fetches fresh numbers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const yearArg = process.argv.indexOf("--year");
const YEAR = yearArg > -1 ? Number(process.argv[yearArg + 1]) : 2027;
const DELAY_MS = 3000;
const BASE = "https://www.ncaa.com/stats/basketball-men/d1";
const UA = "cbb-website stats reader (personal project)";

/**
 * The tables used and the columns kept from each. Column names are
 * NCAA.com's headers; the right-hand names are ours.
 */
const TABLES: { id: number; name: string; columns: Record<string, string> }[] = [
  { id: 145, name: "Scoring Offense", columns: { GM: "games", PTS: "pts" } },
  { id: 146, name: "Scoring Defense", columns: { "OPP PTS": "opp_pts" } },
  { id: 148, name: "Field Goal Percentage", columns: { FGM: "fgm", FGA: "fga" } },
  { id: 149, name: "Field Goal Percentage Defense", columns: { "OPP FG": "opp_fgm", "OPP FGA": "opp_fga" } },
  { id: 638, name: "Free Throw Attempts Per Game", columns: { FT: "ftm", FTA: "fta" } },
  { id: 857, name: "Rebounds (Offensive) Per Game", columns: { ORebs: "oreb" } },
  { id: 859, name: "Rebounds (Defensive) Per Game", columns: { DRebs: "dreb" } },
  { id: 152, name: "Three Point Percentage", columns: { "3FG": "tpm", "3FGA": "tpa" } },
  { id: 518, name: "Three Point Percentage Defense", columns: { "Opp 3FG": "opp_tpm", "Opp 3FGA": "opp_tpa" } },
  { id: 519, name: "Turnover Margin", columns: { TO: "tov", "Opp TO": "opp_tov" } },
];

/** NCAA.com names that don't reduce to ours by the rules in normalize(). */
const NAME_OVERRIDES: Record<string, string> = {
  UNI: "Northern Iowa",
  "Ole Miss": "Ole Miss",
  "UConn": "UConn",
  "Miami (FL)": "Miami",
  "Miami (OH)": "Miami (OH)",
  "St. John's (NY)": "St. John's",
  "Saint Mary's (CA)": "Saint Mary's",
  "NC State": "NC State",
  "LMU (CA)": "Loyola Marymount",
  "Loyola Chicago": "Loyola Chicago",
  "Loyola Maryland": "Loyola Maryland",
  "Charleston So.": "Charleston Southern",
  "UT Martin": "UT Martin",
  "Southern California": "USC",
  "Central Fla.": "UCF",
  "Fla. Atlantic": "Florida Atlantic",
  "FGCU": "Florida Gulf Coast",
  "FIU": "Florida International",
  "LIU": "Long Island University",
  "UMES": "Maryland Eastern Shore",
  "Southeast Mo. St.": "Southeast Missouri State",
  "SIUE": "SIU Edwardsville",
  "Prairie View": "Prairie View A&M",
  "UAlbany": "UAlbany",
  "Seattle U": "Seattle U",
  "ETSU": "East Tennessee State",
  "UTRGV": "UT Rio Grande Valley",
  "UIW": "Incarnate Word",
  "A&M-Corpus Christi": "Texas A&M-Corpus Christi",
  "Texas A&M-CC": "Texas A&M-Corpus Christi",
  "Ga. Southern": "Georgia Southern",
  "Western Caro.": "Western Carolina",
  "Eastern Ky.": "Eastern Kentucky",
  "Western Ky.": "Western Kentucky",
  "Northern Ky.": "Northern Kentucky",
  "Eastern Mich.": "Eastern Michigan",
  "Western Mich.": "Western Michigan",
  "Central Mich.": "Central Michigan",
  "Northern Ill.": "Northern Illinois",
  "Southern Ill.": "Southern Illinois",
  "Eastern Ill.": "Eastern Illinois",
  "Western Ill.": "Western Illinois",
  "Central Ark.": "Central Arkansas",
  "Northern Ariz.": "Northern Arizona",
  "Northern Colo.": "Northern Colorado",
  "South Fla.": "South Florida",
  "Southern Miss.": "Southern Miss",
  "Middle Tenn.": "Middle Tennessee",
  "Eastern Wash.": "Eastern Washington",
  "Col. of Charleston": "Charleston",
  "Charleston": "Charleston",
  "Army West Point": "Army",
  "N.C. A&T": "North Carolina A&T",
  "N.C. Central": "North Carolina Central",
  "UNC Greensboro": "UNC Greensboro",
  "UNCW": "UNC Wilmington",
  "Grambling": "Grambling",
  "Alcorn": "Alcorn State",
  "Ark.-Pine Bluff": "Arkansas-Pine Bluff",
  "Mississippi Val.": "Mississippi Valley State",
  "Bethune-Cookman": "Bethune-Cookman",
  "Gardner-Webb": "Gardner-Webb",
  "Purdue Fort Wayne": "Purdue Fort Wayne",
  "Omaha": "Omaha",
  "UIC": "UIC",
  "Kansas City": "Kansas City",
  "St. Thomas (MN)": "St. Thomas-Minnesota",
  "Queens (NC)": "Queens University",
  "California Baptist": "California Baptist",
  "Cal St. Fullerton": "Cal State Fullerton",
  "CSU Bakersfield": "Cal State Bakersfield",
  "CSUN": "Cal State Northridge",
  "Sacramento St.": "Sacramento State",
  "Saint Francis (PA)": "Saint Francis",
  "St. Francis Brooklyn": "St. Francis Brooklyn",
  "Mount St. Mary's": "Mount St. Mary's",
  "Southern U.": "Southern",
  "Lamar University": "Lamar",
  "Houston Christian": "Houston Christian",
  "Tarleton St.": "Tarleton State",
  "Utah Tech": "Utah Tech",
  "App State": "App State",
  "Boston U.": "Boston University",
  "Penn": "Pennsylvania",
  "Detroit Mercy": "Detroit Mercy",
  "Little Rock": "Little Rock",
  "UT Arlington": "UT Arlington",
  "UTSA": "UTSA",
  "UTEP": "UTEP",
  "Hawaii": "Hawai'i",
  "San Jose St.": "San José State",
  American: "American University",
  "Central Conn. St.": "Central Connecticut",
  FDU: "Fairleigh Dickinson",
  "IU Indy": "IU Indianapolis",
  "LSU New Orleans": "New Orleans",
  NIU: "Northern Illinois",
  "North Ala.": "North Alabama",
  SFA: "Stephen F. Austin",
  "Saint Francis": "St. Francis (PA)",
  "Southeastern La.": "SE Louisiana",
  "Southern Ind.": "Southern Indiana",
  ULM: "UL Monroe",
  "USC Upstate": "South Carolina Upstate",
};
// Schools still reclassifying to Division I (Le Moyne, West Georgia,
// Mercyhurst, New Haven) aren't in NCAA.com's national tables at all.

type Totals = Record<string, number>;

async function main() {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const { data: teams, error } = await db.from("teams").select("id, school").eq("is_d1", true);
  if (error) throw new Error(error.message);

  const bySchool = new Map((teams ?? []).map((t) => [normalize(t.school), t.id as number]));
  const resolve = (ncaaName: string) =>
    bySchool.get(normalize(NAME_OVERRIDES[ncaaName] ?? ncaaName)) ??
    bySchool.get(normalize(expand(ncaaName)));

  const day = new Date().toISOString().slice(0, 10);
  const totals = new Map<string, Totals>();

  for (const table of TABLES) {
    let pages = 0;
    for (let page = 1; ; page++) {
      const html = await fetchPage(table.id, page, day);
      const { headers, rows } = parseTable(html);
      if (!rows.length) break;
      pages++;

      for (const cells of rows) {
        const team = cells[headers.indexOf("Team")];
        if (!team) continue;
        const row = totals.get(team) ?? {};
        for (const [col, key] of Object.entries(table.columns)) {
          const i = headers.indexOf(col);
          if (i < 0) throw new Error(`${table.name}: no column "${col}" in ${headers.join(", ")}`);
          row[key] = Number(cells[i].replace(/,/g, ""));
        }
        totals.set(team, row);
      }
      if (!hasNextPage(html, table.id, page)) break;
    }
    console.log(`  ${table.name}: ${pages} page(s)`);
  }

  const out: Record<number, Totals & { ncaa_name: string }> = {};
  const unmatched: string[] = [];
  for (const [name, row] of totals) {
    const id = resolve(name);
    if (id) out[id] = { ncaa_name: name, ...row } as Totals & { ncaa_name: string };
    else unmatched.push(name);
  }

  const path = `scripts/.cache/ncaa-team-${YEAR}.json`;
  writeFileSync(
    path,
    JSON.stringify({ year: YEAR, fetched: day, source: `${BASE}/${YEAR}/team`, teams: out }, null, 2),
  );
  console.log(`Wrote ${Object.keys(out).length} teams to ${path}.`);
  if (unmatched.length) {
    console.warn(`  ${unmatched.length} NCAA names not matched to teams; add them to NAME_OVERRIDES:`);
    console.warn(`  ${unmatched.sort().join(" | ")}`);
  }
}

async function fetchPage(id: number, page: number, day: string) {
  const dir = `scripts/.cache/ncaa/${YEAR}/${day}`;
  const file = `${dir}/${id}-p${page}.html`;
  if (existsSync(file)) return readFileSync(file, "utf8");

  await new Promise((r) => setTimeout(r, DELAY_MS));
  const url = `${BASE}/${YEAR}/team/${id}${page > 1 ? `/p${page}` : ""}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  // Past the last page NCAA.com returns 404; treat it as the end.
  const html = res.ok ? await res.text() : "";
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, html);
  return html;
}

function parseTable(html: string) {
  const text = (s: string) =>
    s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").trim();
  const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])))
    .filter((cells) => cells.length === headers.length);
  return { headers, rows };
}

function hasNextPage(html: string, id: number, page: number) {
  return html.includes(`/${YEAR}/team/${id}/p${page + 1}"`);
}

/** NCAA.com abbreviations: "Iowa St." -> "Iowa State", and so on. */
function expand(name: string) {
  return name
    .replace(/\bSt\.$/, "State")
    .replace(/\bSt\. /, "State ")
    .replace(/\bU\.$/, "")
    .trim();
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9&]/g, "");
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
