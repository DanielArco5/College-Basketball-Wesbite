import formula from "@/lib/formula-2027.json";
import { FormulaMethod, FormulaRanking } from "./Formula";
import "./rankings.css";

export const metadata = {
  title: "2026-27 Top 25",
  description:
    "Our 2026-27 Top 25: a box-score formula blended with the KenPom, " +
    "Torvik and ESPN preseason rankings.",
};

export default function RankingsPage() {
  return (
    <main className="rank">
      <header>
        <span className="rank-season">
          {formula.stage === "in-season" ? "2026–27 season" : "2026–27 preseason"}
        </span>
        <h1>Top 25</h1>
        <p className="rank-lede">
          Our box-score formula, built on efficiency, defense, rebounding and
          competition, blended with the KenPom, Torvik and ESPN preseason
          rankings.
        </p>
      </header>

      <FormulaRanking />
      <FormulaMethod />
    </main>
  );
}
