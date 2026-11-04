import { getApPolls, LIVE_AP_SEASON } from "@/lib/ap";
import { getRanking } from "@/lib/rankings";
import ApPolls from "../ApPoll";
import { ApDisclaimer, RankHeader } from "../bits";
import "../rankings.css";

export const metadata = {
  title: "AP Top 25",
  description: "The Associated Press Top 25, this season's latest poll and past final polls.",
};

export const revalidate = 300;

export default async function ApPage() {
  const [ranking, polls] = await Promise.all([getRanking(), getApPolls([2027, 2026])]);
  const ours = Object.fromEntries(ranking.formula.rows.map((r) => [r.team_id, r.rk]));
  return (
    <main className="rank rank-ap-page">
      <RankHeader live={ranking.formula.stage === "in-season"} active="ap" title="AP Top 25">
        The Associated Press poll, updated every Monday, with where our
        formula has each team alongside it.
      </RankHeader>
      <ApDisclaimer />
      <ApPolls polls={polls} ours={ours} oursSeason={LIVE_AP_SEASON} />
    </main>
  );
}
