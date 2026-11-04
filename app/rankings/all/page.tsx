import { apRanks } from "@/lib/ap";
import { getRanking } from "@/lib/rankings";
import { ApDisclaimer, RankHeader } from "../bits";
import AllTeams, { type TeamRow } from "./AllTeams";
import "../rankings.css";

export const metadata = {
  title: "Every Division I team, ranked",
  description: "All Division I teams in our 2026-27 formula order, with records and the stats behind them.",
};

export const revalidate = 300;

export default async function AllTeamsPage() {
  const [{ formula }, ap] = await Promise.all([getRanking(), apRanks()]);
  // Only what the table shows: the full rows carry transfers, weights and
  // more, which would bloat the page's data for nothing.
  const rows: TeamRow[] = formula.rows.map((r) => ({
    rk: r.rk,
    team_id: r.team_id,
    school: r.school,
    conference: r.conference,
    wins: r.wins,
    losses: r.losses,
    score: r.score,
    off_eff: r.off_eff,
    oreb_pct: r.oreb_pct,
    to_margin: r.to_margin,
    three_pct: r.three_pct,
    def_eff: r.def_eff,
    ranks: r.ranks,
    identity: r.identity,
    ap: ap.get(r.team_id),
  }));

  return (
    <main className="rank">
      <RankHeader live={formula.stage === "in-season"} active="all" title="All teams">
        All {formula.teams_rated} Division I teams, scored by the same formula
        as the Top 25. The small number under each stat is that team&rsquo;s
        rank in the country. Hand picks in the Top 25 aren&rsquo;t applied
        here; this is the formula&rsquo;s own order.
      </RankHeader>
      <AllTeams rows={rows} />
      <ApDisclaimer />
    </main>
  );
}
