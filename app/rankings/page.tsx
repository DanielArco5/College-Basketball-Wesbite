import Link from "next/link";
import { createServerClient } from "@/lib/supabase-server";
import { loadRatings, sortRatings, RATINGS_SEASON, type RatingSort } from "@/lib/ratings";
import { buildComposite } from "@/lib/preseason";
import RatingsTable, { RatingsCaveat } from "./RatingsTable";
import { PreseasonMethod, PreseasonTable, loadTeamIds } from "./Preseason";
import "./rankings.css";

export const metadata = {
  title: "2026-27 rankings",
  description:
    "A 2026-27 preseason composite of KenPom, Torvik and ESPN, " +
    "plus last season's opponent-adjusted shooting ratings.",
};

/**
 * Two views: the 2026-27 preseason composite (default), and our own
 * 2025-26 ratings, which describe last season and can't rank this one.
 */
const VIEWS = [
  { key: "preseason", label: "2026-27 preseason", href: "/rankings" },
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
  const view = params.view === "last" ? "last" : "preseason";
  const db = createServerClient();

  return (
    <main className="rank">
      <header>
        <span className="rank-season">
          {view === "preseason" ? "2026–27 preseason" : "2025–26 season"}
        </span>
        <h1>{view === "preseason" ? "Top 25" : "Shooting ratings"}</h1>
        <p className="rank-lede">
          {view === "preseason"
            ? "Three of the most-followed preseason rankings, KenPom, Torvik and ESPN, averaged into one list. How it's built is explained below the table."
            : "Points per field goal attempt each team scored and allowed last season, adjusted for the quality of its opponents. Net is the gap between the two."}
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

      {view === "preseason" ? (
        <Preseason db={db} />
      ) : (
        <LastSeason db={db} sort={params.sort} />
      )}
    </main>
  );
}

async function Preseason({ db }: { db: ReturnType<typeof createServerClient> }) {
  const teamIds = await loadTeamIds(db);
  return (
    <>
      <PreseasonTable rows={buildComposite()} teamIds={teamIds} />
      <PreseasonMethod />
    </>
  );
}

async function LastSeason({
  db,
  sort: sortParam,
}: {
  db: ReturnType<typeof createServerClient>;
  sort?: string;
}) {
  const sort: RatingSort =
    sortParam === "off" || sortParam === "def" ? sortParam : "net";
  const { data, error } = await loadRatings(db);

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
