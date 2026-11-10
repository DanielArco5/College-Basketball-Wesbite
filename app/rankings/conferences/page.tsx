import { getRanking } from "@/lib/rankings";
import { RankHeader } from "../bits";
import { ConferencesSection, conferenceTables } from "../sections";
import "../rankings.css";

export const metadata = {
  title: "Conference rankings",
  description: "Every Division I conference, team by team: standings once league play starts, our rating until then.",
};

export const revalidate = 300;

export default async function ConferencesPage() {
  const { formula } = await getRanking();
  const { anyStarted } = conferenceTables(formula);

  return (
    <main className="rank">
      <RankHeader live={formula.stage === "in-season"} active="conferences" title="Conferences">
        {anyStarted
          ? "Each league's standings by conference record, with our national rank and rating alongside. Leagues that haven't started conference play are ordered by our rating."
          : "Conference play hasn't started yet. Until it does, each league is ordered by our rating; once teams play league games, it switches to standings by conference record."}{" "}
        Leagues are listed strongest first, by their teams&rsquo; average rating.
      </RankHeader>
      <ConferencesSection formula={formula} />
    </main>
  );
}
