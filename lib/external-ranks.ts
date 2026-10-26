/**
 * Preseason ranks from KenPom, Torvik and ESPN, blended into our formula by
 * scripts/project-2027.ts (EXTERNAL_WEIGHT). Copied by hand: KenPom is a
 * subscription site that blocks scripts, and Torvik's robots.txt
 * disallows its data files. Only rank positions are stored, never either
 * site's underlying ratings, and all three are credited on the page.
 *
 * TO UPDATE: edit the ranks and bump asOf. Names must match teams.school.
 */

export type ExternalSource = {
  key: "kenpom" | "torvik" | "espn";
  name: string;
  url: string;
  asOf: string;
  note?: string;
  ranks: Record<string, number>;
};

export const EXTERNAL_SOURCES: ExternalSource[] = [
  {
    key: "kenpom",
    name: "KenPom",
    url: "https://kenpom.com/",
    asOf: "2026-10-11",
    note:
      "Subscription site; ranks from published coverage of the preseason release. " +
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
    name: "Torvik",
    url: "https://barttorvik.com/trankpre.php",
    asOf: "2026-10-25",
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
    note: "Expert preseason Top 25 by Jeff Borzello.",
    ranks: {
      Florida: 1, Duke: 2, Illinois: 3, Arizona: 4, UConn: 5,
      "Michigan State": 6, Texas: 7, Tennessee: 8, "Texas Tech": 9, "St. John's": 10,
      Miami: 11, Arkansas: 12, Virginia: 13, Gonzaga: 14, Louisville: 15,
      Missouri: 16, USC: 17, Houston: 18, Kansas: 19, BYU: 20,
      Alabama: 21, Michigan: 22, Vanderbilt: 23, UCLA: 24, Kentucky: 25,
    },
  },
];

/** Torvik's list runs 40 deep; a team on none of the lists ranks below that. */
export const EXTERNAL_DEPTH = 40;
