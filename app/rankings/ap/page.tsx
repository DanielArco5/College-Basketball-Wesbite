import { getRanking } from "@/lib/rankings";
import { RankHeader } from "../bits";
import { ApSection } from "../sections";
import "../rankings.css";

export const metadata = {
  title: "AP Top 25",
  description: "The Associated Press Top 25, this season's latest poll and past final polls.",
};

export const revalidate = 300;

export default async function ApPage() {
  const ranking = await getRanking();
  return (
    <main className="rank rank-ap-page">
      <RankHeader live={ranking.formula.stage === "in-season"} active="ap" title="AP Top 25">
        The Associated Press poll, updated every Monday.
      </RankHeader>
      <ApSection />
    </main>
  );
}
