/**
 * 2026-27 preseason composite: three published rankings averaged.
 *
 * EvanMiya was dropped: only its top 10 is public, too few ranks to
 * weigh it equally against full lists.
 *
 * The ranks below are copied by hand from each source. None of them can be
 * pulled automatically: KenPom blocks scripts and is a subscription site,
 * Torvik's robots.txt disallows its JSON, and ESPN builds its pages in
 * the browser. Only ranks are stored, never a source's
 * underlying ratings, and every source is credited and linked on the page.
 *
 * TO UPDATE: edit a source's `ranks`, bump its `asOf`, and adjust
 * `completeThrough` / `unknownSlots` to match what you actually have.
 * Team names must match `teams.school` exactly so they link to shot charts.
 */

export const PRESEASON_SEASON = 2027;

export type Source = {
  key: "kenpom" | "torvik" | "espn";
  name: string;
  url: string;
  asOf: string;
  kind: string;
  /** Every rank from 1 to this number is listed below. */
  completeThrough: number;
  /** Ranks inside completeThrough we couldn't confirm. */
  unknownSlots: number[];
  note?: string;
  ranks: Record<string, number>;
};

export const SOURCES: Source[] = [
  {
    key: "kenpom",
    name: "KenPom",
    url: "https://kenpom.com/",
    asOf: "2026-10-11",
    kind: "Computer projection: adjusted efficiency from returning players, transfers and recruits",
    completeThrough: 25,
    unknownSlots: [16, 21],
    note:
      "Subscription site. Ranks taken from published coverage of the preseason release; " +
      "Nos. 16 and 21 couldn't be confirmed.",
    ranks: {
      Duke: 1, Florida: 2, Houston: 3, Illinois: 4, Arizona: 5,
      "Iowa State": 6, "Michigan State": 7, Kansas: 8, Alabama: 9, Texas: 10,
      UConn: 11, "Texas Tech": 12, Vanderbilt: 13, Gonzaga: 14, Virginia: 15,
      Louisville: 17, Tennessee: 18, "Texas A&M": 19, Arkansas: 20,
      Miami: 22, "St. John's": 23, Purdue: 24, Auburn: 25,
      Kentucky: 26, Michigan: 28, Oklahoma: 29, Creighton: 30, BYU: 33,
      Marquette: 34, "Ole Miss": 38, Providence: 39, Georgia: 46, Missouri: 48,
    },
  },
  {
    key: "torvik",
    name: "Bart Torvik (T-Rank)",
    url: "https://barttorvik.com/trankpre.php",
    asOf: "2026-10-25",
    kind: "Computer projection: player-based efficiency model, updated as rosters change",
    completeThrough: 40,
    unknownSlots: [],
    ranks: {
      Duke: 1, Arizona: 2, Florida: 3, Kansas: 4, Virginia: 5,
      Houston: 6, Illinois: 7, Gonzaga: 8, Louisville: 9, "Iowa State": 10,
      "Michigan State": 11, Miami: 12, UConn: 13, Michigan: 14, Nebraska: 15,
      Tennessee: 16, "Texas Tech": 17, "St. John's": 18, Texas: 19, "Ohio State": 20,
      Alabama: 21, Arkansas: 22, Vanderbilt: 23, BYU: 24, UCLA: 25,
      Indiana: 26, Kentucky: 27, Oklahoma: 28, Missouri: 29, Purdue: 30,
      Villanova: 31, Marquette: 32, "Texas A&M": 33, "NC State": 34, Georgia: 35,
      USC: 36, Auburn: 37, Clemson: 38, Oregon: 39, Cincinnati: 40,
    },
  },
  {
    key: "espn",
    name: "ESPN",
    url: "https://www.espn.com/mens-college-basketball/story/_/id/50117086/mens-college-basketball-2026-27-preseason-top-25-rankings",
    asOf: "2026-10-07",
    kind: "Expert ranking by Jeff Borzello, not a computer model",
    completeThrough: 25,
    unknownSlots: [],
    ranks: {
      Florida: 1, Duke: 2, Illinois: 3, Arizona: 4, UConn: 5,
      "Michigan State": 6, Texas: 7, Tennessee: 8, "Texas Tech": 9, "St. John's": 10,
      Miami: 11, Arkansas: 12, Virginia: 13, Gonzaga: 14, Louisville: 15,
      Missouri: 16, USC: 17, Houston: 18, Kansas: 19, BYU: 20,
      Alabama: 21, Michigan: 22, Vanderbilt: 23, UCLA: 24, Kentucky: 25,
    },
  },
];

/**
 * What a source says about one team:
 *  - a number: the published rank
 *  - "nr": not ranked, in a source whose list is complete well past the
 *    team (counted as completeThrough + 1)
 *  - null: unknown, because the source's list is short or has gaps
 */
export type SourceRank = number | "nr" | null;

export type CompositeRow = {
  rk: number;
  school: string;
  avg: number;
  ranks: Record<Source["key"], SourceRank>;
  used: number;
};

/**
 * A source's silence only counts against a team when its list is long
 * enough to mean something. Being outside a complete top 25 is real
 * information; being outside a short public list says nothing about
 * whether a team is 11th or 60th.
 */
const MIN_LIST_FOR_NR = 25;

/** Fewer than this many sources and a team isn't ranked. */
const MIN_SOURCES = 2;

export function buildComposite(sources: Source[] = SOURCES): CompositeRow[] {
  const schools = new Set(sources.flatMap((s) => Object.keys(s.ranks)));
  const rows: Omit<CompositeRow, "rk">[] = [];

  for (const school of schools) {
    const ranks = {} as CompositeRow["ranks"];
    const values: number[] = [];

    for (const s of sources) {
      const r = s.ranks[school];
      if (r !== undefined) {
        ranks[s.key] = r;
        values.push(r);
      } else if (
        s.completeThrough >= MIN_LIST_FOR_NR &&
        s.unknownSlots.length === 0
      ) {
        ranks[s.key] = "nr";
        values.push(s.completeThrough + 1);
      } else {
        ranks[s.key] = null;
      }
    }

    // A team only some sources mention is in because of them; it needs at
    // least one actual rank, not just penalties.
    const listed = sources.filter((s) => s.ranks[school] !== undefined).length;
    if (values.length < MIN_SOURCES || listed === 0) continue;

    rows.push({
      school,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      ranks,
      used: values.length,
    });
  }

  // Ties go to the team more sources weighed in on, then the alphabet.
  rows.sort(
    (a, b) => a.avg - b.avg || b.used - a.used || a.school.localeCompare(b.school),
  );
  return rows.map((r, i) => ({ ...r, rk: i + 1 }));
}
