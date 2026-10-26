import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { loadRatings, sortRatings, RATINGS_SEASON, type RatingSort } from "@/lib/ratings";
import RatingsTable, { RatingsCaveat } from "./RatingsTable";
import "./rankings.css";

export const metadata = {
  title: "Team ratings",
  description:
    "Opponent-adjusted shooting ratings for every Division I team, 2025-26.",
};

const SORTS: { key: RatingSort; label: string }[] = [
  { key: "net", label: "Overall" },
  { key: "off", label: "Offense" },
  { key: "def", label: "Defense" },
];

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const params = await searchParams;
  const sort: RatingSort =
    params.sort === "off" || params.sort === "def" ? params.sort : "net";

  const { data, error } = await loadRatings(createServerClient());

  return (
    <main className="rank">
      <header>
        <span className="rank-season">
          {RATINGS_SEASON - 1}–{String(RATINGS_SEASON).slice(2)} season
        </span>
        <h1>Team ratings</h1>
        <p className="rank-lede">
          Points per field goal attempt each team scored and allowed,
          adjusted for the quality of the opponents it played. Net is the
          gap between the two.
        </p>
      </header>

      <nav className="rank-tabs" aria-label="Sort by">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={s.key === "net" ? "/rankings" : `/rankings?sort=${s.key}`}
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
        <p className="rank-error">No ratings for this season yet.</p>
      ) : (
        <RatingsTable rows={sortRatings(data, sort)} sort={sort} />
      )}

      <RatingsCaveat />
    </main>
  );
}
