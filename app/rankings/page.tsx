import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { loadRatings, sortRatings, RATINGS_SEASON, type RatingSort } from "@/lib/ratings";
import RatingsTable, { RatingsCaveat } from "./RatingsTable";
import { FormulaMethod, FormulaRanking } from "./Formula";
import "./rankings.css";

export const metadata = {
  title: "2026-27 Top 25",
  description:
    "Our 2026-27 preseason Top 25, weighted toward offensive efficiency, " +
    "offensive rebounding, turnover margin and three-point shooting.",
};

/**
 * Two views: our 2026-27 formula (default), and our 2025-26 shooting
 * ratings, which describe last season and can't rank this one.
 */
const VIEWS = [
  { key: "formula", label: "2026-27 Top 25", href: "/rankings" },
  { key: "last", label: "2025-26 shooting ratings", href: "/rankings?view=last" },
] as const;

const SORTS: { key: RatingSort; label: string }[] = [
  { key: "net", label: "Overall" },
  { key: "off", label: "Offense" },
  { key: "def", label: "Defense" },
];

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "last" ? "last" : "formula";

  return (
    <main className="rank">
      <header>
        <span className="rank-season">
          {view === "last" ? "2025–26 season" : "2026–27 preseason"}
        </span>
        <h1>{view === "last" ? "Shooting ratings" : "Top 25"}</h1>
        <p className="rank-lede">
          {view === "last"
            ? "Points per field goal attempt each team scored and allowed last season, adjusted for the quality of its opponents. Net is the gap between the two."
            : "Our own projection, built for teams that play hard and score efficiently: offensive rebounding, turnover margin, three-point shooting and points per possession, all adjusted for competition."}
        </p>
      </header>

      <nav className="rank-tabs" aria-label="Rankings">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.href}
            className={view === v.key ? "is-active" : ""}
            aria-current={view === v.key ? "page" : undefined}
            scroll={false}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "formula" ? (
        <>
          <FormulaRanking />
          <FormulaMethod />
        </>
      ) : (
        <LastSeason sort={params.sort} />
      )}
    </main>
  );
}

async function LastSeason({ sort: sortParam }: { sort?: string }) {
  const sort: RatingSort =
    sortParam === "off" || sortParam === "def" ? sortParam : "net";
  const { data, error } = await loadRatings(createServerClient());

  return (
    <>
      <nav className="rank-subtabs" aria-label="Sort by">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={`/rankings?view=last${s.key === "net" ? "" : `&sort=${s.key}`}`}
            className={sort === s.key ? "is-active" : ""}
            aria-current={sort === s.key ? "page" : undefined}
            scroll={false}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <p className="rank-error">Can&rsquo;t load ratings: {error}</p>
      ) : data.length === 0 ? (
        <p className="rank-error">
          No ratings for {RATINGS_SEASON - 1}–{String(RATINGS_SEASON).slice(2)} yet.
        </p>
      ) : (
        <RatingsTable rows={sortRatings(data, sort)} sort={sort} />
      )}

      <RatingsCaveat />
    </>
  );
}
