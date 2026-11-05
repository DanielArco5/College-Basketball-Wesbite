import { getRanking } from "@/lib/rankings";
import { RankHeader } from "./bits";
import { FormulaMethod, FormulaRanking } from "./Formula";
import "./rankings.css";

export const metadata = {
  title: "2026-27 Top 25",
  description:
    "Our 2026-27 Top 25: a box-score formula blended with the KenPom, " +
    "Torvik and ESPN preseason rankings, then rated on every game's box score.",
};

// Rebuilt at most every five minutes: picks up the hourly re-rank, hand
// picks from top25_overrides, and new Live Wire items in the ticker.
export const revalidate = 300;

export default async function RankingsPage() {
  const ranking = await getRanking();
  const { formula } = ranking;
  const live = formula.stage === "in-season";
  return (
    <main className="rank">
      <RankHeader live={live} active="top25" title="Top 25">
        A power rating built the way KenPom and Torvik build theirs: points per
        100 possessions, adjusted for who a team played. It starts from our
        preseason projection (rosters, recruits, competition, blended with
        KenPom, Torvik and ESPN)
        {live
          ? " and moves with every game's box score, a little at a time, so one night can't swing it."
          : ", and moves with every game's box score once the season starts."}
      </RankHeader>

      <FormulaRanking ranking={ranking} />
      <FormulaMethod formula={formula} />
    </main>
  );
}
