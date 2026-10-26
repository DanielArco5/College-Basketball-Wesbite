import formula from "@/lib/formula-2027.json";
import { FormulaMethod, FormulaRanking } from "./Formula";
import "./rankings.css";

export const metadata = {
  title: "2026-27 Top 25",
  description:
    "Our 2026-27 Top 25, weighted toward offensive efficiency, offensive " +
    "rebounding, turnover margin and three-point shooting.",
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
          Built from scratch for teams that play hard and score efficiently:
          offensive rebounding, turnover margin, three-point shooting and
          points per possession, all adjusted for competition.
        </p>
      </header>

      <FormulaRanking />
      <FormulaMethod />
    </main>
  );
}
