import { getRanking } from "@/lib/rankings";
import { RankHeader } from "../bits";
import { AllTeamsSection } from "../sections";
import "../rankings.css";

export const metadata = {
  title: "Every Division I team, ranked",
  description: "All Division I teams in our 2026-27 formula order, with records and the stats behind them.",
};

export const revalidate = 300;

export default async function AllTeamsPage() {
  const { formula } = await getRanking();
  return (
    <main className="rank">
      <RankHeader live={formula.stage === "in-season"} active="all" title="All teams">
        All {formula.teams_rated} Division I teams, rated by the same formula
        as the Top 25 and re-ranked every hour on game days as games go final.
        Arrows show the change since yesterday; the small number under each
        stat is that team&rsquo;s rank in the country. Hand picks in the Top 25 aren&rsquo;t applied
        here; this is the formula&rsquo;s own order.
      </RankHeader>
      <AllTeamsSection formula={formula} />
    </main>
  );
}
