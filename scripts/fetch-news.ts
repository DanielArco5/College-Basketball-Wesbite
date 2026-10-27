/**
 * Pull the latest college basketball headlines into Live Wire.
 *
 *   npm run fetch-news            # add new headlines
 *   npm run fetch-news -- --dry   # print what would be added, write nothing
 *
 * Reads ESPN's and CBS Sports' men's college basketball RSS feeds: public
 * feeds the outlets publish for exactly this, no API key, no API calls
 * against the CBBD budget. Each headline links back to the original
 * story and is credited to its outlet on the site.
 *
 * Kept: men's college basketball stories from the last two days.
 * Dropped: betting picks, TV listings, other sports that leak into a feed,
 * anything already in the table (same link), and the same story from the
 * second outlet (headlines that share most of their words).
 *
 * Tagged by keyword: transfer, commitment, injury, or note. Keywords are
 * a rough cut; anything unsure is a note, the neutral tag.
 *
 * Needs supabase/automation.sql run once (adds the source column).
 */

import { createClient } from "@supabase/supabase-js";

type Kind = "transfer" | "commitment" | "injury" | "note";

const FEEDS = [
  {
    source: "ESPN",
    url: "https://www.espn.com/espn/rss/ncb/news",
    keep: /espn\.com\/mens-college-basketball\//,
  },
  {
    source: "CBS Sports",
    url: "https://www.cbssports.com/rss/headlines/college-basketball/",
    keep: /cbssports\.com\/college-basketball\//,
  },
];

/** Only stories this recent; older ones were news before the last run. */
const MAX_AGE_HOURS = 48;
/** Cap per run, so a backlog can't flood the ticker in one go. */
const MAX_NEW = 12;
/** Share of words two headlines must share to count as the same story. */
const SAME_STORY = 0.5;

const SKIP =
  /\b(odds|picks?|prediction|best bets?|spread|parlay|props?|how to watch|what channel|tv channel|live stream|live updates|mock draft)\b/i;

const KINDS: [Kind, RegExp][] = [
  [
    "injury",
    /\b(injur\w*|out for (the )?season|surgery|torn|tears?|acl|achilles|sidelined|day-to-day|concussion|fracture\w*|sprain\w*|ruled out|medical redshirt)\b/i,
  ],
  ["transfer", /\b(transfers?|transferring|portal)\b/i],
  ["commitment", /\b(commits?|commitment|committed|signs with|pledges?|decommits?|lands)\b/i],
];

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

type Item = { source: string; headline: string; url: string; published_at: string; kind: Kind };

async function main() {
  const dry = process.argv.includes("--dry");
  const cutoff = Date.now() - MAX_AGE_HOURS * 3_600_000;

  const fetched: Item[] = [];
  for (const feed of FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "cbb-website news reader (personal project)" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseRss(await res.text())
        .filter((i) => feed.keep.test(i.url))
        .filter((i) => !SKIP.test(i.headline))
        .filter((i) => Date.parse(i.published_at) >= cutoff)
        .map((i) => ({ ...i, source: feed.source, kind: kindOf(i.headline) }));
      console.log(`  ${feed.source}: ${items.length} recent stories`);
      fetched.push(...items);
    } catch (e) {
      // One outlet down shouldn't stop the other.
      console.warn(`  ${feed.source}: skipped (${(e as Error).message})`);
    }
  }

  // What's already on the wire: exact links, and recent headlines for
  // catching the same story from the other outlet.
  const { data: recent, error } = await db
    .from("live_wire_entries")
    .select("headline, url")
    .order("published_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`live_wire_entries: ${error.message}`);
  const seenUrls = new Set((recent ?? []).map((r) => r.url).filter(Boolean));
  const seenHeads = (recent ?? []).map((r) => words(r.headline));

  const fresh: Item[] = [];
  for (const item of fetched.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))) {
    if (seenUrls.has(item.url)) continue;
    const w = words(item.headline);
    if (seenHeads.some((h) => overlap(h, w) >= SAME_STORY)) continue;
    seenUrls.add(item.url);
    seenHeads.push(w);
    fresh.push(item);
    if (fresh.length === MAX_NEW) break;
  }

  if (!fresh.length) {
    console.log("Nothing new.");
    return;
  }
  for (const i of fresh) console.log(`  + [${i.kind}] ${i.headline} (${i.source})`);
  if (dry) {
    console.log(`Dry run: ${fresh.length} would be added.`);
    return;
  }

  const { error: insertError } = await db
    .from("live_wire_entries")
    .insert(fresh.map((i) => ({ ...i, is_live: true })));
  if (insertError) {
    throw new Error(
      `Insert failed: ${insertError.message}\n` +
        "If it mentions the source column, run supabase/automation.sql once in the SQL editor.",
    );
  }
  console.log(`Added ${fresh.length} to Live Wire.`);
}

function kindOf(headline: string): Kind {
  return KINDS.find(([, re]) => re.test(headline))?.[0] ?? "note";
}

/** Just enough RSS: title, link and date from each <item>. */
function parseRss(xml: string) {
  const field = (block: string, tag: string) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) return "";
    return decode(m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).trim();
  };
  return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)]
    .map((m) => {
      const date = Date.parse(field(m[0], "pubDate"));
      return {
        headline: field(m[0], "title").replace(/\s+/g, " "),
        url: field(m[0], "link"),
        published_at: Number.isNaN(date) ? "" : new Date(date).toISOString(),
      };
    })
    .filter((i) => i.headline && /^https:\/\//.test(i.url) && i.published_at);
}

function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const STOP = new Set(["the", "a", "an", "and", "of", "to", "in", "for", "on", "at", "with", "as", "is", "his", "her", "after", "over", "by", "from"]);

function words(headline: string) {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Shared words over the shorter headline's words. */
function overlap(a: Set<string>, b: Set<string>) {
  const small = a.size <= b.size ? a : b;
  const large = small === a ? b : a;
  if (!small.size) return 0;
  let n = 0;
  for (const w of small) if (large.has(w)) n++;
  return n / small.size;
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
